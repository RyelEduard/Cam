export type Unit = "MPH" | "KPH";

export type SpeedoPos = "BL" | "BR" | "TL" | "TR";

export interface AnalysisResult {
  summary: string;
  maxSpeed: string;
  averageSpeed: string;
  consistency: string;
  insights: string[];
}
