import express, { json } from 'express'
import cors from "cors"
import formidableMiddleware from 'express-formidable';
import { extract } from './src/services/extraction.js';
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
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
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({
                status: "error",
                error: {
                    message: "No files were uploaded",
                    code: 'NO_FILES_UPLOADED'
                }
            });
        }

        const validationError = validateFiles(req.files);
        if (validationError) {
            cleanUp(req.files);
            return res.status(400).json(validationError);
        }

        try {
            const extracts = await extract(req.files);
            cleanUp(req.files);

            if (extracts[0]?.status === "error") {
                return res.status(422).json(extracts[0]);
            }

            return res.status(200).json(extracts);

        } catch (extractError) {
            console.error('Extraction error:', extractError);
            cleanUp(req.files);
            return res.status(500).json({
                status: "error",
                error: {
                    message: "Failed to process files",
                    code: 'EXTRACTION_FAILED',
                    details: extractError.message
                }
            });
        }

    } catch (error) {
        console.error('Server error:', error);
        if (req.files) {
            cleanUp(req.files);
        }
        return res.status(500).json({
            status: "error",
            error: {
                message: "Internal server error",
                code: error.code || 'INTERNAL_SERVER_ERROR',
                details: error.message
            }
        });
    }
});

function validateFiles(files) {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg' ,'image/psd', 'application/x-photoshop'];
    const maxSize = 8 * 1024 * 1024;

    for (const file of Object.values(files)) {
        console.log(file)
        if (!allowedTypes.includes(file.type)) {
            return {
                status: "error",
                error: {
                    message: `Invalid file type: ${file.type}. Allowed types: JPEG, JPG, PNG, PSD`,
                    code: 'INVALID_FILE_TYPE'
                }
            };
        }

        if ((file.type ==='image/jpeg' || file.type === 'image/png' || file.type === 'image/jpg') && file.size > maxSize) {
            return {
                status: "error",
                error: {
                    message: `File too large: ${file.name}. Maximum size: 8 MB`,
                    code: 'FILE_TOO_LARGE'
                }
            };
        }

        if (file.size === 0) {
            return {
                status: "error",
                error: {
                    message: `Empty or corrupted file: ${file.name}`,
                    code: 'INVALID_FILE'
                }
            };
        }
    }

    return null;
}

function cleanUp(multiPartfiles) {
    if (!multiPartfiles) return;

    const files = Object.values(multiPartfiles);
    for (const file of files) {
        const filePath = file.filepath || file.path;
        if (!filePath) continue;

        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Successfully deleted ${filePath}`);
            }
        } catch (error) {
            console.error(`Error deleting ${filePath}:`, error);
        }
    }
}

const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`1B2B listening on port ${port}`)
})