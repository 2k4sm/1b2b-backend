import * as fs from "fs";
import Psd from "@webtoon/psd";
import * as path from "path";

export function extract(multipartFiles) {
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

    return extractPSD(psdFiles)
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

    // Process layer position
    if (props.top !== undefined && props.left !== undefined) {
        output.image_description.content.text_overlay.positions.push({
            top: props.top,
            left: props.left,
            bottom: props.bottom,
            right: props.right,
            name: props.name
        });
    }

    if (props.opacity !== undefined) {
        const opacity = (props.opacity / 255 * 100).toFixed(0);
        if (opacity < 100) {
            output.image_description.content.text_overlay.opacity = `${opacity}%`;
        }
    }

    if (layer.layerFrame?.channels) {
        const channels = Array.from(layer.layerFrame.channels.values());
        if (channels.length > 0) {
            const color = channels[0].color;
            if (color) {
                output.colors.primary.push(color);
            }
        }
    }
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

function extractImage(files){

}