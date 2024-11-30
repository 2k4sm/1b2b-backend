import * as fs from "fs";
import path from "path";
import mime from "mime-types";
import sharp from "sharp";

export async function processImageFile(filePath, adAnalyzer) {
    validateFilePath(filePath);

    const imageBuffer = readImageFile(filePath);
    const fileInfo = await getFileInfo(filePath, imageBuffer);
    const analysis = await adAnalyzer.analyzeAd(imageBuffer);
    const textExtraction = processTextContent(analysis.content?.text_content);

    return {
        file_info: fileInfo,
        analysis: analysis,
        text_extraction: textExtraction
    };
}

function validateFilePath(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
        throw new Error('Invalid file path');
    }
}

function readImageFile(filePath) {
    try {
        return fs.readFileSync(filePath);
    } catch (readError) {
        throw new Error(`Failed to read file: ${readError.message}`);
    }
}

async function getFileInfo(filePath, imageBuffer) {
    const fileExtension = path.extname(filePath).toLowerCase();
    const mimeType = mime.lookup(filePath);
    const stats = fs.statSync(filePath);
    const metadata = await sharp(imageBuffer).metadata();

    return {
        name: path.basename(filePath),
        size: stats.size,
        type: mimeType,
        extension: fileExtension,
        dimensions: {
            width: metadata.width,
            height: metadata.height
        }
    };
}

function processTextContent(textContent) {
    if (!textContent) {
        return createEmptyTextExtraction();
    }

    const extraction = {
        primary_text: "",
        headline: textContent.headline.map(h => h.text).join(' '),
        description: "",
        call_to_action: textContent.cta.map(c => c.text).join(' ')
    };

    processBodyText(textContent.body_text, extraction);
    addDisclaimers(textContent.disclaimers, extraction);
    normalizeTextFields(extraction);

    return extraction;
}

function processBodyText(bodyTexts, extraction) {
    const sortedTexts = bodyTexts
        .map(b => ({
            text: b.text,
            fontSize: b.font_size,
            position: b.position
        }))
        .sort((a, b) => b.fontSize - a.fontSize);

    for (const textElement of sortedTexts) {
        if (textElement.text.length > 30 && !extraction.description) {
            extraction.description = textElement.text;
        } else {
            extraction.primary_text += textElement.text + ' ';
        }
    }
}

function addDisclaimers(disclaimers, extraction) {
    if (disclaimers && disclaimers.length > 0) {
        extraction.primary_text += disclaimers.map(d => d.text).join(' ');
    }
}

function normalizeTextFields(textObject) {
    Object.keys(textObject).forEach(key => {
        textObject[key] = textObject[key]
            .trim()
            .replace(/\s+/g, ' ');
    });
}

export function createResponse(processed, successful, results) {
    return {
        status: "success",
        processed_count: processed,
        successful_count: successful,
        results: results
    };
}

function createEmptyTextExtraction() {
    return {
        primary_text: "",
        headline: "",
        description: "",
        call_to_action: ""
    };
}