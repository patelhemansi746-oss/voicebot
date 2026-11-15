import { FramePayload } from './capture.adapter';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  boundingBox?: BoundingBox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
  boundingBox?: BoundingBox;
}

export interface OcrExtractionResult {
  fullText: string;
  lines: OcrLine[];
  averageConfidence: number;
  sourceFrameId: string;
  extractionDurationMs: number;
}

export type VisualElementType = 
  | 'code_editor' 
  | 'pdf_viewer' 
  | 'file_browser' 
  | 'terminal' 
  | 'button' 
  | 'dialog'
  | 'text_block';

export interface VisualElement {
  type: VisualElementType;
  name: string;
  description: string;
  confidence: number;
  boundingBox?: BoundingBox;
}

export interface VisionDescriptionResult {
  sceneSummary: string;
  detectedApplication: string;
  activeWindow: string;
  elements: VisualElement[];
  primaryFocusText?: string;
  processingDurationMs: number;
}

/**
 * Formal OCR and Vision Adapter Contract (Week 2 - Days 8–9)
 */
export interface IOcrVisionAdapter {
  extractText(frame: FramePayload): Promise<OcrExtractionResult>;
  describeVision(frame: FramePayload): Promise<VisionDescriptionResult>;
}

/**
 * MockOcrVisionAdapter
 * 
 * Default offline implementation that processes synthetic frames into structured
 * OCR lines, word tokens, confidence scores, and visual elements without requiring
 * external paid cloud APIs or real screenshots.
 */
export class MockOcrVisionAdapter implements IOcrVisionAdapter {
  private simulatedLatencyMs: number;

  constructor(simulatedLatencyMs: number = 10) {
    this.simulatedLatencyMs = simulatedLatencyMs;
  }

  /**
   * Extracts text, lines, and token-level confidences from the synthetic frame.
   */
  public async extractText(frame: FramePayload): Promise<OcrExtractionResult> {
    const startTime = Date.now();
    if (this.simulatedLatencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.simulatedLatencyMs));
    }

    const rawText = frame.ocrContent || '';
    const rawLines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const lines: OcrLine[] = rawLines.map((lineStr, lineIdx) => {
      const rawWords = lineStr.split(/\s+/).filter(w => w.length > 0);
      const words: OcrWord[] = rawWords.map((wordStr, wordIdx) => ({
        text: wordStr,
        confidence: 0.98,
        boundingBox: {
          x: 100 + wordIdx * 50,
          y: 80 + lineIdx * 25,
          width: wordStr.length * 8,
          height: 18
        }
      }));

      return {
        text: lineStr,
        confidence: 0.98,
        words,
        boundingBox: {
          x: 100,
          y: 80 + lineIdx * 25,
          width: lineStr.length * 8,
          height: 20
        }
      };
    });

    const averageConfidence = lines.length > 0 ? 0.98 : 1.0;
    const duration = Date.now() - startTime;

    return {
      fullText: rawText,
      lines,
      averageConfidence,
      sourceFrameId: frame.frameId,
      extractionDurationMs: duration
    };
  }

  /**
   * Generates a multimodal semantic description of windows and visual UI elements in the frame.
   */
  public async describeVision(frame: FramePayload): Promise<VisionDescriptionResult> {
    const startTime = Date.now();
    if (this.simulatedLatencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.simulatedLatencyMs));
    }

    const app = frame.application || 'Unknown Application';
    const windowTitle = frame.windowTitle || 'Desktop Workspace';
    const elements: VisualElement[] = [];

    // Synthesize visual elements according to active application context
    if (app.toLowerCase().includes('code') || windowTitle.toLowerCase().includes('.ts')) {
      elements.push({
        type: 'code_editor',
        name: 'VS Code Editor Buffer',
        description: `Active TypeScript file: ${windowTitle}`,
        confidence: 0.99,
        boundingBox: { x: 50, y: 50, width: 1200, height: 800 }
      });
      if (frame.ocrContent.includes('TypeError') || frame.ocrContent.includes('Error')) {
        elements.push({
          type: 'dialog',
          name: 'Debug Console / Error Diagnostic',
          description: 'Stack trace visible in developer panel',
          confidence: 0.97,
          boundingBox: { x: 50, y: 700, width: 1200, height: 250 }
        });
      }
    } else if (app.toLowerCase().includes('pdf') || windowTitle.toLowerCase().includes('.pdf')) {
      elements.push({
        type: 'pdf_viewer',
        name: 'Document Page View',
        description: `Visible document: ${windowTitle}`,
        confidence: 0.98,
        boundingBox: { x: 200, y: 40, width: 900, height: 1000 }
      });
    } else if (app.toLowerCase().includes('explorer') || app.toLowerCase().includes('files')) {
      elements.push({
        type: 'file_browser',
        name: 'File System Directory View',
        description: `Folder window: ${windowTitle}`,
        confidence: 0.96,
        boundingBox: { x: 100, y: 100, width: 800, height: 600 }
      });
    }

    elements.push({
      type: 'text_block',
      name: 'Primary Screen OCR Region',
      description: `${frame.ocrContent.length} characters of visible text`,
      confidence: 0.98
    });

    const duration = Date.now() - startTime;

    return {
      sceneSummary: `Visual scene displays ${app} displaying "${windowTitle}".`,
      detectedApplication: app,
      activeWindow: windowTitle,
      elements,
      primaryFocusText: frame.ocrContent.slice(0, 150),
      processingDurationMs: duration
    };
  }
}
