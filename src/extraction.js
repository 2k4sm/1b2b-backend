import * as fs from "fs";
import Psd from "@webtoon/psd";
import * as path from "path";
import { AdAnalysisService } from "./rekognition.js";
import mime from 'mime-types';
import sharp from "sharp";
import * as Color from "color";


export async function extract(multipartFiles) {
    let imageFiles = []
    let psdFiles = []
    const files = Object.values(multipartFiles);
    
    // Separate files by type
    for (const file of files) {
        const filePath = file.filepath || file.path;
        const ext = path.extname(filePath);
        if (ext === ".psd") {
            psdFiles.push(filePath);
        } else {
            imageFiles.push(filePath);
        }
    }

    console.log(imageFiles)
    // Process both types
    const imageResults = await extractImage(imageFiles);
    const psdResults = extractPSD(psdFiles);

    return [imageResults, psdResults];
}

function extractPSD(files) {
    if (!files || files.length === 0) {
        return;
    }

    let processedFiles = [];
    
    for (const file of files) {
        try {
            const psd_file = fs.readFileSync(file);
            const parsedPsd = Psd.parse(psd_file.buffer);
            const extractedData = processFile(parsedPsd);
            if (extractedData) {
                processedFiles.push(extractedData);
            }
        } catch (error) {
            console.error(`Error processing file: ${error.message}`);
        }
    }

    if (processedFiles.length === 0) {
        return;
    }

    return [
        {
            status: "success",
            processed_count: processedFiles.length,
            successful_count: processedFiles.filter(f => !f.file_info.error).length,
            results: processedFiles
        }
    ];
}

function processFile(psdFile) {
    const details = {
        layers: [],
        colors: new Set(),
        textElements: []
    };

    traverseLayers(psdFile, details);

    return formatOutput(psdFile, details);
}

function traverseLayers(node, details, path = '') {
    if (node.type === "Layer") {
        const layerInfo = extractLayerInfo(node, path);
        details.layers.push(layerInfo);

        if (layerInfo.color) {
            details.colors.add(layerInfo.color);
        }

        if (layerInfo.text) {
            details.textElements.push({
                layer_name: layerInfo.name,
                path: layerInfo.path,
                text: layerInfo.text.value,
                position: layerInfo.bounds,
                styles: {
                    font: layerInfo.text.font,
                    fontSize: layerInfo.text.fontSize,
                    color: layerInfo.text.color,
                    alignment: layerInfo.text.alignment,
                    ...layerInfo.text.styles
                }
            });
        }
    }

    node.children?.forEach((child, index) => {
        const newPath = path ? `${path}/${child.name}` : child.name;
        traverseLayers(child, details, newPath);
    });
}

function extractLayerInfo(layer, path) {
    const layerInfo = {
        name: layer.name || "",
        path: path,
        type: determineLayerType(layer),
        bounds: {
            top: layer.top || 0,
            right: layer.right || 0,
            bottom: layer.bottom || 0,
            left: layer.left || 0
        },
        blendMode: layer.blendMode || 'normal',
        opacity: layer.opacity || 255,
        visible: layer.visible ?? true
    };

    // Extract text information
    if (layer.text) {
        layerInfo.text = extractTextInfo(layer.text);
    }

    // Extract color information
    layerInfo.color = extractLayerColor(layer);

    return layerInfo;
}

function determineLayerType(layer) {
    if (layer.text) return 'text';
    if (layer.smartObject) return 'smartObject';
    if (layer.adjustment) return 'adjustment';
    if (layer.shape) return 'shape';
    if (layer.image) return 'image';
    return 'layer';
}

function extractTextInfo(textData) {
    return {
        value: textData.value || "",
        font: textData.font || "",
        fontSize: textData.fontSize || 0,
        color: extractColor(textData.color),
        alignment: textData.alignment || "left",
        styles: {
            bold: textData.bold || false,
            italic: textData.italic || false,
            underline: textData.underline || false
        }
    };
}

function extractLayerColor(layer) {
    // Try fill color
    if (layer.fill?.color) {
        return extractColor(layer.fill.color);
    }

    // Try solid color
    if (layer.solidColor) {
        return extractColor(layer.solidColor);
    }

    // Try channels
    if (layer.channels && layer.channels.length >= 3) {
        const [r, g, b] = layer.channels;
        if (r?.data?.[0] !== undefined && 
            g?.data?.[0] !== undefined && 
            b?.data?.[0] !== undefined) {
            return rgbToHex(r.data[0], g.data[0], b.data[0]);
        }
    }

    // Try additional layer properties
    if (layer.additionalLayerProperties?.SoCo?.data?.Clr) {
        const color = layer.additionalLayerProperties.SoCo.data.Clr;
        if (color.Rd !== undefined && color.Grn !== undefined && color.Bl !== undefined) {
            return rgbToHex(color.Rd * 255, color.Grn * 255, color.Bl * 255);
        }
    }

    return null;
}

function extractColor(color) {
    if (!color) return null;

    // Handle RGB
    if (color.r !== undefined && color.g !== undefined && color.b !== undefined) {
        return rgbToHex(color.r, color.g, color.b);
    }

    // Handle CMYK
    if (color.c !== undefined && color.m !== undefined && 
        color.y !== undefined && color.k !== undefined) {
        const r = 255 * (1 - color.c) * (1 - color.k);
        const g = 255 * (1 - color.m) * (1 - color.k);
        const b = 255 * (1 - color.y) * (1 - color.k);
        return rgbToHex(r, g, b);
    }

    return null;
}

function formatOutput(psdFile, details) {
    const colors = Array.from(details.colors);

    return {
        file_info: {
            name: psdFile.name || "ROOT",
            size: psdFile.fileSize || 0,
            type: "image/psd",
            extension: ".psd",
            dimensions: {
                width: psdFile.width,
                height: psdFile.height
            }
        },
        analysis: {
            status: "success",
            image_specs: {
                dimensions: {
                    width: psdFile.width,
                    height: psdFile.height
                },
                format: "psd",
                aspect_ratio: parseFloat((psdFile.width / psdFile.height).toFixed(2)),
                size_category: getSizeCategory(psdFile.width, psdFile.height)
            },
            content: {
                visual_elements: {
                    products: [],
                    people: [],
                    background_elements: [],
                    branding: []
                },
                text_content: {
                    headline: details.textElements
                        .filter(t => t.layer_name.toLowerCase().includes('headline'))
                        .map(t => ({
                            text: t.text,
                            position: t.position,
                            font_size: t.styles.fontSize
                        })),
                    body_text: details.textElements
                        .filter(t => !t.layer_name.toLowerCase().match(/headline|cta|disclaimer/))
                        .map(t => ({
                            text: t.text,
                            position: t.position,
                            font_size: t.styles.fontSize
                        })),
                    cta: details.textElements
                        .filter(t => t.layer_name.toLowerCase().includes('cta'))
                        .map(t => ({
                            text: t.text,
                            position: t.position,
                            font_size: t.styles.fontSize
                        })),
                    disclaimers: details.textElements
                        .filter(t => t.layer_name.toLowerCase().includes('disclaimer'))
                        .map(t => ({
                            text: t.text,
                            position: t.position,
                            font_size: t.styles.fontSize
                        }))
                },
                color_scheme: {
                    dominant: colors[0] || null,
                    accent: colors.slice(1, 3),
                    background: details.layers.find(l => 
                        l.name.toLowerCase().includes('background'))?.color || null,
                    contrast_ratio: null
                }
            }
        },
        text_extraction: {
            primary_text: details.textElements
                .find(t => !t.layer_name.toLowerCase().match(/headline|cta|disclaimer/))?.text || "",
            headline: details.textElements
                .find(t => t.layer_name.toLowerCase().includes('headline'))?.text || "",
            description: details.textElements
                .find(t => t.layer_name.toLowerCase().includes('description'))?.text || "",
            call_to_action: details.textElements
                .find(t => t.layer_name.toLowerCase().includes('cta'))?.text || "",
            content_text: {
                all_text: details.textElements.map(t => t.text).join(' ').trim(),
                layer_texts: details.textElements.map(t => ({
                    layer: t.layer_name,
                    path: t.path,
                    text: t.text,
                    position: t.position,
                    styles: t.styles
                }))
            }
        },
        layers: details.layers.map(layer => ({
            name: layer.name,
            path: layer.path,
            type: layer.type,
            bounds: layer.bounds,
            text: layer.text,
            color: layer.color,
            blendMode: layer.blendMode,
            opacity: layer.opacity,
            visible: layer.visible
        }))
    };
}

function getSizeCategory(width, height) {
    const area = width * height;
    if (area <= 300000) return "small";
    if (area <= 1000000) return "medium";
    return "large";
}

function rgbToHex(r, g, b) {
    if (r === undefined || g === undefined || b === undefined) {
        return null;
    }
    
    r = Math.min(255, Math.max(0, Math.round(Number(r))));
    g = Math.min(255, Math.max(0, Math.round(Number(g))));
    b = Math.min(255, Math.max(0, Math.round(Number(b))));
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

async function extractImage(filePaths) {
    try {
        const adAnalyzer = new AdAnalysisService();
        let processedFiles = [];
        
        if (!filePaths || filePaths.length === 0) {
            return {
                status: "success",
                processed_count: 0,
                successful_count: 0,
                results: []
            };
        }

        for (const filePath of filePaths) {
            try {
                if (!filePath || !fs.existsSync(filePath)) {
                    throw new Error('Invalid file path');
                }

                const fileExtension = path.extname(filePath).toLowerCase();
                const mimeType = mime.lookup(filePath);
                const stats = fs.statSync(filePath);
                
                let imageBuffer;
                try {
                    imageBuffer = fs.readFileSync(filePath);
                } catch (readError) {
                    throw new Error(`Failed to read file: ${readError.message}`);
                }

                const metadata = await sharp(imageBuffer).metadata();
                const { width: imageWidth, height: imageHeight } = metadata;
                
                const analysis = await adAnalyzer.analyzeAd(imageBuffer);

                const result = {
                    file_info: {
                        name: path.basename(filePath),
                        size: stats.size,
                        type: mimeType,
                        extension: fileExtension,
                        dimensions: {
                            width: imageWidth,
                            height: imageHeight
                        }
                    },
                    analysis: analysis,
                    text_extraction: {
                        primary_text: "",
                        headline: "",
                        description: "",
                        call_to_action: ""
                    }
                };
                
                // Extract text from categorized text content
                if (analysis.content?.text_content) {
                    // Extract headline
                    if (analysis.content.text_content.headline.length > 0) {
                        result.text_extraction.headline = analysis.content.text_content.headline
                            .map(h => h.text)
                            .join(' ');
                    }

                    // Extract CTA
                    if (analysis.content.text_content.cta.length > 0) {
                        result.text_extraction.call_to_action = analysis.content.text_content.cta
                            .map(c => c.text)
                            .join(' ');
                    }

                    // Process body text
                    const bodyTexts = analysis.content.text_content.body_text.map(b => ({
                        text: b.text,
                        fontSize: b.font_size,
                        position: b.position
                    }));

                    // Sort by font size to identify potential descriptions (larger font size)
                    bodyTexts.sort((a, b) => b.fontSize - a.fontSize);

                    // Separate description (longer text) from primary text
                    bodyTexts.forEach(textElement => {
                        if (textElement.text.length > 30) {
                            if (!result.text_extraction.description) {
                                result.text_extraction.description = textElement.text;
                            } else {
                                result.text_extraction.primary_text += textElement.text + ' ';
                            }
                        } else {
                            result.text_extraction.primary_text += textElement.text + ' ';
                        }
                    });

                    // Add disclaimers to primary text if they exist
                    if (analysis.content.text_content.disclaimers.length > 0) {
                        const disclaimerText = analysis.content.text_content.disclaimers
                            .map(d => d.text)
                            .join(' ');
                        result.text_extraction.primary_text += disclaimerText;
                    }
                }
                
                // Clean up extracted text
                Object.keys(result.text_extraction).forEach(key => {
                    result.text_extraction[key] = result.text_extraction[key]
                        .trim()
                        .replace(/\s+/g, ' '); // Replace multiple spaces with single space
                });
                
                processedFiles.push(result);
                
            } catch (fileError) {
                console.error(`Error processing file ${path.basename(filePath)}:`, fileError);
                processedFiles.push({
                    file_info: {
                        name: path.basename(filePath),
                        error: fileError.message
                    },
                    success: false
                });
            }
        }
        
        return {
            status: "success",
            processed_count: processedFiles.length,
            successful_count: processedFiles.filter(f => !f.file_info.error).length,
            results: processedFiles
        };
        
    } catch (error) {
        return {
            status: "error",
            error: {
                message: error.message,
                code: error.code || 'UNKNOWN_ERROR'
            },
            processed_count: 0,
            successful_count: 0,
            results: []
        };
    }
}
