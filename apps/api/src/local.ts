import "dotenv/config";
import { app } from "./server.js";

const port = Number(process.env.PORT ?? 3333);

app.listen(port, () => {
  console.log(`CEO Pet AI API running on http://localhost:${port}`);
});
