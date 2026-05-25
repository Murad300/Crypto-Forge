import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";
import path from "path";

async function runTest() {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (!fs.existsSync(configPath)) {
    console.error("Config not found");
    return;
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  console.log("Config loaded:", JSON.stringify(config, null, 2));

  try {
    const app = initializeApp(config);
    console.log("Firebase Web SDK initialized");

    const db = getFirestore(app, config.firestoreDatabaseId);
    console.log("Initializing database:", config.firestoreDatabaseId);

    console.log("Querying 'users' collection...");
    const snap = await getDocs(collection(db, "users"));
    console.log("Success! size:", snap.size);
  } catch (error: any) {
    console.error("Test failed with Web SDK:", error);
  }
}

runTest();
