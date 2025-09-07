// src/services/report.ts
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

const REPORTS_DIR = "reports";
const DOCS_DIR = "docs";

export async function ensureDirs() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
  await fs.mkdir(DOCS_DIR, { recursive: true });
}

export async function buildPdf(mdTitle: string, hits: string[], summaryText: string) {
  const ts = Date.now();
  const pdfPath = path.join(REPORTS_DIR, `reporte-${ts}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = (doc as any).pipe(fssync.createWriteStream(pdfPath));
    doc.fontSize(18).text(mdTitle, { underline: true });
    doc.moveDown();
    doc.fontSize(10).text(`Fecha: ${new Date().toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(14).text("Archivos:");
    doc.moveDown(0.5);
    if (hits.length) hits.forEach(h => doc.fontSize(12).text(`• ${h}`));
    else doc.fontSize(12).text("Sin coincidencias");
    if (summaryText) {
      doc.moveDown();
      doc.fontSize(14).text("Resumen (LLM local):");
      doc.moveDown(0.5);
      summaryText.split("\n").forEach(l => doc.fontSize(12).text(l));
    }
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  return pdfPath;
}

export async function buildMarkdown(title: string, query: string | undefined, hits: string[], summaryBlock?: string) {
  const ts = Date.now();
  const mdPath = path.join(REPORTS_DIR, `reporte-${ts}.md`);
  let md = `# ${title}\n\n`;
  md += `Fecha: ${new Date().toISOString()}\n\n`;
  md += `## Archivos coincidentes en \`${DOCS_DIR}\`${query ? ` (query: \`${query}\`)` : ""}\n`;
  md += hits.length ? hits.map(h => `- ${h}`).join("\n") + "\n\n" : "_Sin coincidencias_\n\n";
  if (summaryBlock) {
    md += `## Resumen (LLM local)\n${summaryBlock}\n\n`;
  }
  await fs.writeFile(mdPath, md, "utf8");
  return mdPath;
}

export async function listDocHits(query?: string) {
  const files = await fs.readdir(DOCS_DIR);
  const q = (query || "").toLowerCase();
  const hits: string[] = [];
  for (const f of files) {
    const p = path.join(DOCS_DIR, f);
    const stat = await fs.stat(p);
    if (!stat.isFile()) continue;
    const txt = await fs.readFile(p, "utf8").catch(() => "");
    if (!q || txt.toLowerCase().includes(q) || f.toLowerCase().includes(q)) {
      hits.push(f);
    }
  }
  return hits;
}