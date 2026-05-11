import { existsSync, readdirSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

// Dev-only upload helper copied from ../mmkal.com/upload.ts.
const captureMode = process.argv.includes("capture");
const uploadDir = await mkdtemp(join(tmpdir(), "bun-uploads-"));
const savedFiles = new Set<string>();

const server = Bun.serve({
  port: captureMode ? 0 : Number(process.env.PORT || 3000),
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response(page(url), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method !== "POST") {
      return new Response("method not allowed\n", { status: 405 });
    }

    const requestedName = url.searchParams.get("filename") || "";
    const fallbackName = `upload-${new Date().toISOString().replaceAll(":", "-")}`;
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return new Response("missing file\n", { status: 400 });
    }

    const name = safeName(requestedName || file.name || fallbackName);
    const extension = extname(file.name || "");
    const filePath = join(uploadDir, name.includes(".") || !extension ? name : `${name}${extension}`);

    await Bun.write(filePath, file);
    savedFiles.add(filePath);

    return new Response(`uploaded to ${filePath}. run again to capture another\n`, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`upload dir: ${uploadDir}`);
console.log(`url: http://${localIp()}:${server.port}/`);
console.log(`local: http://localhost:${server.port}/`);

if (captureMode) {
  console.log(`capture url: http://${localIp()}:${server.port}/`);
  await pollForUpload();
  server.stop(true);
}

function page(url: URL) {
  const action = `${url.pathname}${url.search}`;

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>upload</title>
  </head>
  <body style="font-family: sans-serif; margin: 2rem; max-width: 32rem">
    <form method="post" enctype="multipart/form-data" action="${escapeHtml(action)}">
      <input id="file" name="file" type="file" accept="image/*" style="display: block; margin-bottom: 1rem">
    </form>
    <pre id="result" style="white-space: pre-wrap"></pre>
    <img id="preview" alt="" style="display: none; max-width: 100%">
    <script>
      const form = document.querySelector("form");
      const input = document.querySelector("#file");
      const result = document.querySelector("#result");
      const preview = document.querySelector("#preview");
      let previewUrl;

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!input.files.length) return;
        await upload(input.files[0]);
      });

      input.addEventListener("change", async () => {
        if (!input.files.length) return;
        await upload(input.files[0]);
      });

      window.addEventListener("paste", async (event) => {
        const files = [...event.clipboardData.files];
        const items = [...event.clipboardData.items].map((item) => item.getAsFile()).filter(Boolean);
        const file = [...files, ...items].find((item) => item.type.startsWith("image/"));
        if (file) await upload(file);
      });

      async function upload(file) {
        const body = new FormData();
        body.append("file", file, file.name || "paste.png");
        const response = await fetch(location.href, { method: "POST", body });
        result.textContent = await response.text();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        preview.src = previewUrl;
        preview.style.display = "block";
      }
    </script>
  </body>
</html>`;
}

function safeName(name: string) {
  const cleaned = basename(name).replaceAll("/", "-").replaceAll("\\", "-").trim();
  return cleaned || `upload-${Date.now()}`;
}

async function pollForUpload() {
  while (true) {
    const existing = readdirSync(uploadDir).map((file) => join(uploadDir, file));
    const filePath = [...savedFiles, ...existing].find((path) => existsSync(path));

    if (filePath) {
      console.log(`saved: ${filePath}`);
      return;
    }

    await Bun.sleep(250);
  }
}

function localIp() {
  const interfaces = networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        return address.address;
      }
    }
  }

  return "localhost";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
