import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const child = spawn(process.execPath, ["build/app.js"], {
  env: { ...process.env, PORT: "18081", DATABASE_URL: "" },
  stdio: "pipe",
});
let output = "";
child.stderr.on("data", (chunk) => { output += chunk; });
try {
  let healthy = false;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch("http://localhost:18081/api/v1/health");
      assert.equal(response.status, 200);
      healthy = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  assert.ok(healthy, `Server did not start: ${output}`);
  const ready = await fetch("http://localhost:18081/api/v1/ready");
  assert.equal(ready.status, 503);
  console.log("PASS: health 200; readiness 503 without database configuration");
} finally {
  child.kill();
}
