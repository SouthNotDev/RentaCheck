import React, { createContext, useContext, useMemo, useState } from 'react';

export type ParsedExogena = {
  year: number;
  fullName?: string;
  documentId?: string;
  ingresosCop?: number;
  patrimonioCop?: number;
  movimientosCop?: number;
  ivaResponsable?: boolean;
  debug?: {
    source?: 'excel' | 'csv' | 'txt' | 'unknown';
    sampleRows?: string[];
    incomesCandidates?: Array<{ rowIndex: number; max: number; text: string }>;
    patrimonyCandidates?: Array<{ rowIndex: number; max: number; text: string }>;
    movementCandidates?: Array<{ rowIndex: number; max: number; text: string }>;
    chosen?: {
      ingresosCop?: number;
      patrimonioCop?: number;
      movimientosCop?: number;
    };
  };
};

export type PropertyInputItem = {
  id: string;
  source: 'receipt' | 'manual';
  receipt?: { file_name?: string; file_base64?: string };
  manual?: { valorCop?: number | null; confidence?: 'exact' | 'approx' | 'unknown' };
};

export type VehicleInputItem = {
  id: string;
  source: 'receipt' | 'manual';
  receipt?: { file_name?: string; file_base64?: string };
  manual?: { valorCop?: number | null; confidence?: 'exact' | 'approx' | 'unknown' };
};

export type Survey = {
  iva_responsable?: boolean | null;
  properties?: PropertyInputItem[];
  vehicles?: VehicleInputItem[];
  // Compatibilidad con esquema anterior
  inmuebles?: {
    had?: boolean | null;
    valorCop?: number | null;
    confidence?: 'exact' | 'approx' | 'unknown';
  };
  vehiculos?: {
    had?: boolean | null;
    valorCop?: number | null;
    confidence?: 'exact' | 'approx' | 'unknown';
  };
};

export type ContactData = {
  email: string;
  phone: string;
};

export type AnalysisCitation = {
  indice?: number;
  snippet?: string;
  articulo?: string | null;
  ley?: string | null;
  titulo?: string | null;
  fecha?: string | null;
  // URL ya no se usa en v3; mantener opcional por compatibilidad
  url?: string;
  // Nuevo: links provisionales (no usados por el LLM; sólo UI)
  provisional_url?: string | null;
  link_status?: 'placeholder' | 'verified' | string | null;
};

export type AnalysisResult = {
  decision: boolean;
  determinantes: {
    supera_ingresos: boolean;
    supera_patrimonio: boolean;
    supera_movimientos: boolean;
    iva_responsable: boolean;
  };
  // Nuevo esquema v3
  resumen?: string;
  explicacion_formal?: string;
  // Alias temporal para compatibilidad con UI antigua
  explicacion_llm?: string;
  citas: AnalysisCitation[];
  identidad?: { nombre?: string | null; documento?: string | null };
  thresholds?: { income_threshold_uvt: number; income_threshold_cop: number; patrimony_threshold_uvt: number; patrimony_threshold_cop: number; movements_threshold_uvt: number; movements_threshold_cop: number; uvt_value: number };
  // Valores finales extraídos/evaluados por el backend
  valores_finales?: {
    ingresos_cop: number;
    patrimonio_cop: number;
    movimientos_cop: number;
    iva_responsable: boolean;
  };
  uncertainty?: {
    patrimony_unknown?: boolean;
    patrimony_approx_components?: string[];
    patrimony_from_survey_cop?: number;
    used_patrimony_source?: 'exogena' | 'survey' | 'max';
    iva_unknown?: boolean;
    notes?: string[];
  };
  __session_id?: string;
  __progress?: Array<{ step: string; status: 'start' | 'ok' | 'error'; ts: string; durationMs?: number; meta?: Record<string, any> }>;
};

type FlowContextValue = {
  uploadedFile: File | null;
  setUploadedFile: (f: File | null) => void;
  parsed: ParsedExogena | null;
  setParsed: (p: ParsedExogena | null) => void;
  survey: Survey | null;
  setSurvey: (s: Survey | null) => void;
  contact: ContactData | null;
  setContact: (c: ContactData | null) => void;
  paid: boolean;
  setPaid: (v: boolean) => void;
  result: AnalysisResult | null;
  setResult: (r: AnalysisResult | null) => void;
};

const FlowContext = createContext<FlowContextValue | undefined>(undefined);

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedExogena | null>(null);
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [contact, setContact] = useState<ContactData | null>(null);
  const [paid, setPaid] = useState<boolean>(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const value = useMemo(
    () => ({ uploadedFile, setUploadedFile, parsed, setParsed, survey, setSurvey, contact, setContact, paid, setPaid, result, setResult }),
    [uploadedFile, parsed, survey, contact, paid, result]
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow must be used within FlowProvider');
  return ctx;
}



