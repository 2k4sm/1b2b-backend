import express, { json } from 'express'
import cors from "cors"
import formidableMiddleware from 'express-formidable';
import { extract } from './src/extraction.js';
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { time } from 'console';
dotenv.config();
const app = express()

app.use(cors())
app.use(json())
app.use(formidableMiddleware({
    encoding: 'utf-8',
    uploadDir: './uploads',
    multiples: true,
    keepExtensions : true,
}))

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.get('/', (req, res) => {
  res.send({
    message: "muah😘...",
    time : new Date()
  })
})

app.post('/analyse', async (req, res) => {

    const extracts = await extract(req.files)

    cleanUp(req.files)
    res.send(extracts)
})

function cleanUp(multiPartfiles) {
    const files = Object.values(multiPartfiles);
    for (const file of files) {
        const filePath = file.filepath || file.path;

        try {
            fs.unlinkSync(filePath); // Synchronous version
            console.log(`Successfully deleted ${filePath}`);
        } catch (error) {
            console.error(`Error deleting ${filePath}:`, error);
        }
    }

}

const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`1B2B listening on port ${port}`)
})