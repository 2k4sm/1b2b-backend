import * as fs from "fs";
import PSD from "psd";
import * as path from "path";
import { AdAnalysisService } from "../utils/rekognition.js";
import { extractTreeData, getSizeCategory } from "../utils/psdParser.js";
import { processImageFile, createResponse } from "../utils/imgUtils.js";

export async function extract(multipartFiles) {
    let imageFiles = []
    let psdFiles = []
    const files = Object.values(multipartFiles);

    for (const file of files) {
        const filePath = file.filepath || file.path;
        const ext = path.extname(filePath);
        if (ext === ".psd") {
            psdFiles.push(filePath);
        } else {
            imageFiles.push(filePath);
        }
    }

    const imageResults = await extractImage(imageFiles);
    const psdResults = await extractPSD(psdFiles);

    return [imageResults, psdResults];
}

async function extractPSD(files) {
    if (!files || files.length === 0) return;

    let processedFiles = [];
    
    for (const file of files) {
        try {
            const psd = await PSD.open(file);
            psd.parse();
            const tree = psd.tree().export();
            
            const extractedData = extractTreeData(tree);
            
            const data = {
                file_info: {
                    name: path.basename(file),
                    size: fs.statSync(file).size,
                    dimensions: {
                        width: tree.document.width,
                        height: tree.document.height
                    }
                },
                analysis: {
                    status: "success",
                    image_specs: {
                        dimensions: {
                            width: tree.document.width,
                            height: tree.document.height
                        },
                        format: "psd",
                        aspect_ratio: parseFloat((tree.document.width / tree.document.height).toFixed(2)),
                        size_category: getSizeCategory(tree.document.width, tree.document.height)
                    },
                    content: {
                        text_content: extractedData.textContent,
                        groups: extractedData.groups
                    }
                },
                text_extraction: {
                    primary_text: extractedData.allText,
                    headline: extractedData.headline,
                    description: extractedData.description,
                    content_text: {
                        all_text: extractedData.allText,
                        by_group: extractedData.textByGroup
                    }
                }
            };
            
            processedFiles.push(data);
            
        } catch (error) {
            console.error(`Error processing file ${file}:`, error);
            return {
                status: "error",
                error: {
                    message: error.message,
                    code: error.code || 'UNKNOWN_ERROR'
                },
            };
        }
    }

    return {
        type : "psd",
        status: "success",
        processed_count: processedFiles.length,
        successful_count: processedFiles.filter(f => !f.file_info.error).length,
        results: processedFiles
    };
}


export async function extractImage(filePaths) {
    try {
        if (!filePaths || filePaths.length === 0) {
            return createResponse(0, 0, []);
        }

        const adAnalyzer = new AdAnalysisService();
        let processedFiles = [];

        for (const filePath of filePaths) {
            try {
                const result = await processImageFile(filePath, adAnalyzer);
                processedFiles.push(result);
            } catch (fileError) {
                console.error(`Error processing file ${path.basename(filePath)}:`, fileError);
                return {
                    status: "error",
                    error: {
                        message: fileError.message,
                        code: fileError.code || 'UNKNOWN_ERROR'
                    },
                };
            }
        }

        return createResponse(
            processedFiles.length,
            processedFiles.filter(f => !f.file_info.error).length,
            processedFiles
        );

    } catch (error) {
        return {
            status: "error",
            error: {
                message: error.message,
                code: error.code || 'UNKNOWN_ERROR'
            },
        };
    }
}
