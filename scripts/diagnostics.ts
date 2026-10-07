import "dotenv/config";
const origin = process.env.TEST_URL || "http://127.0.0.1:3000";
const health = await fetch(origin + "/healthz");
console.log(JSON.stringify(await health.json()));
