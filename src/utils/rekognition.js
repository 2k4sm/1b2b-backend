import { RekognitionClient, DetectLabelsCommand, DetectTextCommand } from "@aws-sdk/client-rekognition";
import sharp from "sharp";

export class AdAnalysisService {
    constructor() {
        this.rekognition = new RekognitionClient({
            region: process.env.AWS_DEFAULT_REGION,
        });
    }

    async analyzeAd(imageBuffer) {
        try {
            const metadata = await this.getImageMetadata(imageBuffer);
            
            const analysis = {
                status: "success",
                image_specs: {
                    dimensions: metadata.dimensions,
                    format: metadata.format,
                    aspect_ratio: Math.round((metadata.dimensions.width / metadata.dimensions.height) * 100) / 100,
                    size_category: this.getImageSizeCategory(metadata.dimensions),
                },
                content: {
                    visual_elements: {
                        products: [],         
                        people: [],           
                        background_elements: [], 
                        branding: [],         
                    },
                    text_content: {
                        headline: [],         
                        body_text: [],        
                        cta: [],             
                        disclaimers: [],     
                    },
                    color_scheme: {
                        dominant: null,       
                        accent: [],           
                        background: null,    
                        contrast_ratio: 0     
                    },
                    composition_metrics: {
                        text_coverage: 0,     
                        visual_coverage: 0,   
                        white_space: 0,       
                        balance_score: 0      
                    }
                }
            };

            const imageParams = {
                Image: { Bytes: imageBuffer }
            };

            const [labels, text, colors] = await Promise.all([
                this.detectObjects(imageParams),
                this.detectText(imageParams),
                this.analyzeColors(imageBuffer)
            ]);

            if (labels?.Labels) {
                this.categorizeVisualElements(labels.Labels, analysis.content.visual_elements);
                analysis.content.composition_metrics.visual_coverage = 
                    this.calculateAreaCoverage(labels.Labels);
            }

            if (text?.TextDetections) {
                this.categorizeTextElements(
                    text.TextDetections,
                    analysis.content.text_content,
                    metadata.dimensions
                );
                analysis.content.composition_metrics.text_coverage = 
                    this.calculateAreaCoverage(text.TextDetections);
            }

            if (colors) {
                analysis.content.color_scheme = {
                    dominant: colors.primary[0],
                    accent: colors.secondary,
                    background: colors.background[0],
                    contrast_ratio: await this.calculateContrastRatio(colors.background[0], colors.primary[0])
                };
            }

            analysis.content.composition_metrics = {
                ...analysis.content.composition_metrics,
                white_space: 1 - (analysis.content.composition_metrics.text_coverage + 
                                analysis.content.composition_metrics.visual_coverage),
                balance_score: this.calculateBalanceScore(
                    text?.TextDetections,
                    labels?.Labels,
                    metadata.dimensions
                )
            };

            return analysis;

        } catch (error) {
            console.error('Error in analyzeAd:', error);
            return {
                status: "error",
                error: {
                    message: error.message,
                    code: error.code || 'UNKNOWN_ERROR',
                    details: process.env.NODE_ENV === 'development' ? error.stack : undefined
                }
            };
        }
    }

    async getImageMetadata(imageBuffer) {
        const metadata = await sharp(imageBuffer).metadata();
        return {
            dimensions: {
                width: metadata.width,
                height: metadata.height
            },
            format: metadata.format
        };
    }

    async detectObjects(params) {
        const command = new DetectLabelsCommand({
            ...params,
            MaxLabels: 20,
            MinConfidence: 80
        });
        return this.rekognition.send(command);
    }

    async detectText(params) {
        const command = new DetectTextCommand(params);
        return this.rekognition.send(command);
    }

    async analyzeColors(imageBuffer) {
        const { dominant } = await sharp(imageBuffer).stats();
        const { data } = await sharp(imageBuffer)
            .raw()
            .toBuffer({ resolveWithObject: true });

        const colorCounts = new Map();
        for (let i = 0; i < data.length; i += 3) {
            const color = this.rgbToHex(data[i], data[i + 1], data[i + 2]);
            colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
        }

        const sortedColors = [...colorCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([color]) => color);

        return {
            primary: [this.rgbToHex(dominant.r, dominant.g, dominant.b)],
            secondary: sortedColors.slice(2, 4),
            background: [sortedColors[sortedColors.length - 1]]
        };
    }

    async calculateContrastRatio(bg, fg) {
        const getRelativeLuminance = (hex) => {
            const rgb = this.hexToRgb(hex);
            const [r, g, b] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(val => 
                val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
            );
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };

        const l1 = getRelativeLuminance(bg);
        const l2 = getRelativeLuminance(fg);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return Math.round(ratio * 10) / 10;
    }

    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    rgbToHex(r, g, b) {
        return '#' + [r, g, b]
            .map(x => Math.round(x).toString(16).padStart(2, '0'))
            .join('');
    }

    getImageSizeCategory(dimensions) {
        const area = dimensions.width * dimensions.height;
        if (area < 250000) return 'small';
        if (area < 1000000) return 'medium';
        return 'large';
    }

    categorizeVisualElements(labels, visualElements) {
        const productKeywords = ['Product', 'Item', 'Goods', 'Package', 'Container'];
        const brandingKeywords = ['Logo', 'Brand', 'Symbol', 'Trademark'];
        
        labels.forEach(label => {
            const element = {
                name: label.Name,
                confidence: label.Confidence,
                position: label.Instances?.[0]?.BoundingBox ? {
                    x: Math.round(label.Instances[0].BoundingBox.Left * 100),
                    y: Math.round(label.Instances[0].BoundingBox.Top * 100),
                    width: Math.round(label.Instances[0].BoundingBox.Width * 100),
                    height: Math.round(label.Instances[0].BoundingBox.Height * 100)
                } : null,
                size: label.Instances?.[0] ? 
                    (label.Instances[0].BoundingBox.Width * label.Instances[0].BoundingBox.Height) : 0
            };

            if (label.Name.includes('Person') || label.Name.includes('Human')) {
                visualElements.people.push(element);
            } else if (productKeywords.some(keyword => label.Name.includes(keyword))) {
                visualElements.products.push(element);
            } else if (brandingKeywords.some(keyword => label.Name.includes(keyword))) {
                visualElements.branding.push(element);
            } else {
                visualElements.background_elements.push(element);
            }
        });
    }

    categorizeTextElements(textDetections, textContent, dimensions) {
        textDetections
            .filter(t => t.Type === 'LINE' && t.Confidence > 90)
            .forEach(text => {
                const element = {
                    text: text.DetectedText,
                    position: {
                        x: Math.round(text.Geometry.BoundingBox.Left * dimensions.width),
                        y: Math.round(text.Geometry.BoundingBox.Top * dimensions.height),
                        width: Math.round(text.Geometry.BoundingBox.Width * dimensions.width),
                        height: Math.round(text.Geometry.BoundingBox.Height * dimensions.height)
                    },
                    confidence: text.Confidence,
                    font_size: this.estimateFontSize(text.Geometry.BoundingBox.Height * dimensions.height)
                };

                const yPosition = element.position.y / dimensions.height;
                const fontSize = element.font_size;

                if (fontSize > 24 && yPosition < 0.3) {
                    textContent.headline.push(element);
                } else if (fontSize < 12 && yPosition > 0.8) {
                    textContent.disclaimers.push(element);
                } else if (this.isCallToAction(text.DetectedText)) {
                    textContent.cta.push(element);
                } else {
                    textContent.body_text.push(element);
                }
            });
    }

    isCallToAction(text) {
        const ctaKeywords = /\b(buy|shop|get|order|call|click|visit|learn|discover|find|see|watch|sign up|join|start)\b/i;
        return ctaKeywords.test(text) && text.length < 35;
    }

    estimateFontSize(heightInPixels) {
        return Math.round(heightInPixels * 0.75);
    }

    calculateBalanceScore(textDetections, labels, dimensions) {
        if (!textDetections?.length && !labels?.length) return 0.5;

        const gridSize = 10;
        const grid = Array(gridSize).fill(0).map(() => Array(gridSize).fill(0));
        
        const mapToGrid = (box) => {
            const startX = Math.floor(box.Left * gridSize);
            const startY = Math.floor(box.Top * gridSize);
            const endX = Math.min(Math.floor((box.Left + box.Width) * gridSize), gridSize - 1);
            const endY = Math.min(Math.floor((box.Top + box.Height) * gridSize), gridSize - 1);

            for (let y = startY; y <= endY; y++) {
                for (let x = startX; x <= endX; x++) {
                    if (y >= 0 && y < gridSize && x >= 0 && x < gridSize) {
                        grid[y][x]++;
                    }
                }
            }
        };

        textDetections?.forEach(text => mapToGrid(text.Geometry.BoundingBox));
        labels?.forEach(label => {
            label.Instances?.forEach(instance => mapToGrid(instance.BoundingBox));
        });

        let leftWeight = 0, rightWeight = 0, topWeight = 0, bottomWeight = 0;
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const weight = grid[y][x];
                if (x < gridSize / 2) leftWeight += weight;
                else rightWeight += weight;
                if (y < gridSize / 2) topWeight += weight;
                else bottomWeight += weight;
            }
        }

        const horizontalBalance = 1 - Math.abs(leftWeight - rightWeight) / Math.max(leftWeight + rightWeight, 1);
        const verticalBalance = 1 - Math.abs(topWeight - bottomWeight) / Math.max(topWeight + bottomWeight, 1);

        return (horizontalBalance + verticalBalance) / 2;
    }

    calculateAreaCoverage(elements) {
        if (!elements || elements.length === 0) return 0;
        
        const totalArea = elements.reduce((sum, element) => {
            const box = element.Geometry?.BoundingBox || element.Instances?.[0]?.BoundingBox;
            return sum + (box ? box.Width * box.Height : 0);
        }, 0);
        
        return Math.min(totalArea, 1);
    }
}