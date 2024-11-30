export function extractTreeData(tree) {
    const textElements = [];
    const groups = [];
    const textByGroup = {};
    let headline = "";
    let allText = "";

    function processLayer(layer, groupName = null) {
        if (layer.text) {
            const textElement = {
                text: layer.text.value,
                position: {
                    top: layer.top,
                    left: layer.left,
                    width: layer.width,
                    height: layer.height
                },
                font_size: layer.text.font?.sizes?.[0] || 0
            };
            textElements.push(textElement);
            
            if (groupName) {
                if (!textByGroup[groupName]) {
                    textByGroup[groupName] = [];
                }
                textByGroup[groupName].push(textElement);
            }

            allText += " " + layer.text.value;

            if (textElement.font_size >= 40 && !headline) {
                headline = layer.text.value;
            }
        }
    }

    function processNode(node) {
        if (node.type === 'group') {
            const group = {
                name: node.name,
                bounds: {
                    top: node.top,
                    right: node.right,
                    bottom: node.bottom,
                    left: node.left
                },
                layers: []
            };

            if (node.children) {
                node.children.forEach(child => {
                    if (child.type === 'layer') {
                        const layer = {
                            name: child.name,
                            type: child.text ? 'text' : 'image',
                            visible: child.visible,
                            opacity: child.opacity,
                            bounds: {
                                top: child.top,
                                right: child.right,
                                bottom: child.bottom,
                                left: child.left
                            }
                        };
                        
                        if (child.text) {
                            layer.text = {
                                value: child.text.value,
                                styles: {
                                    font: child.text.font?.names?.[0] || "",
                                    fontSize: child.text.font?.sizes?.[0] || 0,
                                    color: child.text.font?.colors?.[0] ? rgbaToHex(child.text.font.colors[0]) : null,
                                }
                            };
                            processLayer(child, node.name);
                        }
                        
                        group.layers.push(layer);
                    }
                });
            }
            
            groups.push(group);
        } else if (node.children) {
            node.children.forEach(child => processNode(child));
        }
    }

    processNode(tree);

    const description = textElements
        .filter(t => t.font_size < 30)
        .map(t => t.text)
        .join(' ');

    return {
        textContent: {
            headline: textElements.filter(t => t.font_size >= 40),
            body_text: textElements.filter(t => t.font_size < 40),
            cta: textElements.filter(t => t.text && 
                (t.text.toLowerCase().includes('cta') || 
                 t.text.toLowerCase().includes('call') || 
                 t.text.toLowerCase().includes('click')))
        },
        groups,
        textByGroup,
        allText: allText.trim(),
        headline,
        description
    };
}

function rgbaToHex(rgba) {
    if (!Array.isArray(rgba) || rgba.length < 3) return null;
    
    const [r, g, b, a = 255] = rgba;
    
    const red = Math.min(255, Math.max(0, Math.round(Number(r))));
    const green = Math.min(255, Math.max(0, Math.round(Number(g))));
    const blue = Math.min(255, Math.max(0, Math.round(Number(b))));
    const alpha = Math.min(255, Math.max(0, Math.round(Number(a))));
    
    if (alpha < 255) {
        return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}${alpha.toString(16).padStart(2, '0')}`;
    }
    
    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
}

export function getSizeCategory(width, height) {
    const area = width * height;
    if (area <= 300000) return "small";
    if (area <= 1000000) return "medium";
    return "large";
}