import * as fs from "fs";
import Psd from "@webtoon/psd";
import * as path from "path";
import { AdAnalysisService } from "./rekognition.js";
import mime from 'mime-types';
import sharp from "sharp";


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
    let processedFiles = [];
    
    for (const file of files) {
        const psd_file = fs.readFileSync(file);
        const parsedPsd = Psd.parse(psd_file.buffer);
        const extractedData = processFile(parsedPsd);
        processedFiles.push(extractedData);
    }

    return processedFiles;
}

function processFile(psdFile) {
    const output = {
        text: {
            primary_text: "",
            headline: "",
            description: "",
            call_to_action: ""
        },
        image_description: {
            type: "static_image",
            dimensions: {
                width: psdFile.width,
                height: psdFile.height,
                aspect_ratio: `${(psdFile.width / psdFile.height).toFixed(2)}:1`
            },
            content: {
                main_subject: "",
                background: "",
                text_overlay: {
                    positions: []
                },
                brand_elements: {}
            },
            technical_specs: {
                color_space: "sRGB",
                resolution: `${psdFile.resolution?.horizontal || 72}dpi`
            }
        },
        colors: {
            primary: [],
            secondary: [],
            gradient: []
        }
    };

    traverseNode(psdFile, output);
    return cleanOutput(output);
}

function traverseNode(node, output) {
    if (node.type === "Layer") {
        processLayer(node, output);
    }

    node.children?.forEach((child) => traverseNode(child, output));
}

function cleanOutput(obj) {
    const cleaned = {};
    
    for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object') {
            if (Array.isArray(value)) {
                if (value.length > 0) {
                    cleaned[key] = value;
                }
            } else {
                const cleanedChild = cleanOutput(value);
                if (Object.keys(cleanedChild).length > 0) {
                    cleaned[key] = cleanedChild;
                }
            }
        } else if (value !== "" && value !== null && value !== undefined) {
            cleaned[key] = value;
        }
    }
    
    return cleaned;
}

function rgbToHex(r, g, b) {
    if (r === undefined || g === undefined || b === undefined) {
        return null;
    }
    
    r = Math.min(255, Math.max(0, Math.round(Number(r))));
    g = Math.min(255, Math.max(0, Math.round(Number(g))));
    b = Math.min(255, Math.max(0, Math.round(Number(b))));
    
    const toHex = (n) => {
        const hex = n.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    
    return '#' + toHex(r) + toHex(g) + toHex(b);
}

function processLayer(layer, output) {
    const props = layer.layerFrame?.layerProperties;
    if (!props) return;

    if (props.name) {
        if (props.name.includes('<FR>')) {
            output.text.primary_text = props.name.replace('<FR>', '').trim();
        } else if (props.name.toLowerCase().includes('headline')) {
            output.text.headline = props.name;
        } else if (props.name.toLowerCase().includes('cta')) {
            output.text.call_to_action = props.name;
        } else if (props.name.toLowerCase().includes('description')) {
            output.text.description = props.name;
        }
    }

    if (props.top !== undefined && props.left !== undefined) {
        output.image_description.content.text_overlay.positions.push({
            top: props.top,
            left: props.left,
            bottom: props.bottom,
            right: props.right,
            name: props.name
        });
    }

    const colorInfo = {
        color: null,
        opacity: props.opacity !== undefined ? props.opacity / 255 : 1,
        blendMode: props.blendMode || 'normal'
    };

    if (layer.layerFrame?.additionalLayerProperties) {
        const layerProps = layer.layerFrame.additionalLayerProperties;
        
        if (layerProps.SoCo?.data?.Clr) {
            const solidColor = layerProps.SoCo.data.Clr;
            if (solidColor.Rd !== undefined && solidColor.Grn !== undefined && solidColor.Bl !== undefined) {
                colorInfo.color = rgbToHex(
                    solidColor.Rd * 255,
                    solidColor.Grn * 255,
                    solidColor.Bl * 255
                );
            }
        }

        if (layerProps.GdFl?.data?.Clrs) {
            const gradientColors = layerProps.GdFl.data.Clrs
                .map(c => {
                    if (c?.Clr?.Rd !== undefined && c?.Clr?.Grn !== undefined && c?.Clr?.Bl !== undefined) {
                        return rgbToHex(c.Clr.Rd * 255, c.Clr.Grn * 255, c.Clr.Bl * 255);
                    }
                    return null;
                })
                .filter(color => color !== null);

            if (gradientColors.length > 0) {
                output.colors.gradient.push({
                    type: 'gradient',
                    colors: gradientColors
                });
            }
        }
    }

    if (layer.layerFrame?.channels) {
        const channels = Array.from(layer.layerFrame.channels.values());
        if (channels.length >= 3) {
            const [red, green, blue] = channels;
            if (red?.data?.[0] !== undefined && 
                green?.data?.[0] !== undefined && 
                blue?.data?.[0] !== undefined) {
                colorInfo.color = rgbToHex(
                    red.data[0],
                    green.data[0],
                    blue.data[0]
                );
            }
        }
    }

    if (colorInfo.color) {
        const colorEntry = {
            color: colorInfo.color,
            opacity: colorInfo.opacity,
            source: props.name || 'unnamed_layer'
        };

        if (props.name?.toLowerCase().includes('bg') || 
            (colorInfo.blendMode === 'normal' && colorInfo.opacity === 1)) {
            output.colors.primary.push(colorEntry);
        } else {
            output.colors.secondary.push({
                ...colorEntry,
                blendMode: colorInfo.blendMode
            });
        }
    }

    if (props.opacity !== undefined) {
        const opacity = (props.opacity / 255 * 100).toFixed(0);
        if (opacity < 100) {
            output.image_description.content.text_overlay.opacity = `${opacity}%`;
        }
    }
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
