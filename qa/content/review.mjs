/**
 * Pre-publication QC for a Studio 2 script package.
 * Claims, quotes, numbers, dates, images and source liveness are checked
 * against the stored sources in the package. No network unless probe:true.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  contentWords, overlap, sentences, extractQuotes, extractDates, extractNumbers, sameNumber, sourceBlob
} from './extract.mjs';
import { inspectVideo, probeMedia } from './video.mjs';

function findingId(kind, key) {
  const hash = crypto.createHash('sha1').update(`${kind}\n${key}`).digest('hex').slice(0, 8);
  return `QC-${kind}-${hash}`;
}

function add(findings, kind, severity, key, summary, evidence) {
  const id = findingId(kind, key);
  if (findings.some(item => item.id === id)) return;
  findings.push({ id, kind, severity, summary, evidence });
}

export function assertScript(script) {
  if (!script || typeof script !== 'object') throw new Error('invalid script: expected an object');
  if (!script.id || typeof script.id !== 'string') throw new Error('invalid script: id is required');
  if (!Array.isArray(script.sources)) throw new Error('invalid script: sources must be an array');
  const hasBody = typeof script.body === 'string' && script.body.trim();
  const hasClaims = Array.isArray(script.claims) && script.claims.length;
  if (!hasBody && !hasClaims) throw new Error('invalid script: body or claims is required');
  for (const source of script.sources) {
    if (!source || typeof source.id !== 'string' || !source.id) throw new Error('invalid script: each source needs an id');
  }
}

export function sourceAlive(source) {
  if (!source) return false;
  if (source.error) return false;
  if (source.alive === false) return false;
  if (typeof source.status === 'number' && (source.status < 200 || source.status >= 400)) return false;
  if (source.status == null && source.alive == null && !String(source.text || '').trim() && !String(source.title || '').trim()) return false;
  return true;
}

export async function probeSources(sources, fetchImpl = globalThis.fetch) {
  const out = [];
  for (const source of sources) {
    if (!source.url) {
      out.push({ ...source, alive: false, error: source.error || 'no url', probe: { ok: false, error: 'no url' } });
      continue;
    }
    try {
      const response = await fetchImpl(source.url, { method: 'GET', redirect: 'follow' });
      const status = response.status;
      const ok = status >= 200 && status < 400;
      out.push({ ...source, status, alive: ok, error: ok ? null : `HTTP ${status}`, probe: { ok, status } });
    } catch (error) {
      out.push({ ...source, alive: false, error: error.message, probe: { ok: false, error: error.message } });
    }
  }
  return out;
}

function scannedText(script) {
  const parts = [script.body || ''];
  for (const claim of script.claims || []) parts.push(claim.text || '');
  return parts.join('\n');
}

function quoteFindings(text, sources, findings) {
  for (const quote of extractQuotes(text)) {
    const needle = quote.toLowerCase();
    const hit = sources.find(source => sourceBlob(source).toLowerCase().includes(needle));
    if (!hit) {
      add(findings, 'quote_mismatch', 'major', needle, `Quoted text is not in any stored source: “${quote}”`, { quote });
    }
  }
}

function numberFindings(text, sources, findings) {
  for (const sentence of sentences(text)) {
    const words = new Set(contentWords(sentence));
    for (const num of extractNumbers(sentence)) {
      const supported = sources.some(source => extractNumbers(sourceBlob(source)).some(other => sameNumber(other.value, num.value)));
      if (supported) continue;
      let contradicted = null;
      for (const source of sources) {
        for (const otherSentence of sentences(sourceBlob(source))) {
          const shared = contentWords(otherSentence).filter(word => words.has(word));
          const others = extractNumbers(otherSentence).filter(other => !sameNumber(other.value, num.value));
          if (shared.length >= 2 && others.length) {
            contradicted = { sourceId: source.id, display: others[0].display, value: others[0].value };
            break;
          }
        }
        if (contradicted) break;
      }
      if (contradicted) {
        add(findings, 'number_mismatch', 'major', `${num.value}|${sentence}`, `Script says ${num.display}; source ${contradicted.sourceId} says ${contradicted.display} in a related sentence`, {
          script: num.display, scriptValue: num.value, source: contradicted
        });
      } else {
        add(findings, 'unsupported_number', 'major', `${num.value}|${sentence}`, `Number ${num.display} is not in any stored source`, { display: num.display, value: num.value });
      }
    }
  }
}

function dateFindings(text, sources, findings) {
  for (const sentence of sentences(text)) {
    const words = new Set(contentWords(sentence));
    for (const date of extractDates(sentence)) {
      const supported = sources.some(source => extractDates(sourceBlob(source)).includes(date));
      if (supported) continue;
      let contradicted = null;
      for (const source of sources) {
        for (const otherSentence of sentences(sourceBlob(source))) {
          const shared = contentWords(otherSentence).filter(word => words.has(word));
          const others = extractDates(otherSentence).filter(other => other !== date);
          if (shared.length >= 2 && others.length) {
            contradicted = { sourceId: source.id, date: others[0] };
            break;
          }
        }
        if (contradicted) break;
      }
      if (contradicted) {
        add(findings, 'date_mismatch', 'major', `${date}|${sentence}`, `Script date ${date} disagrees with ${contradicted.date} in source ${contradicted.sourceId}`, {
          scriptDate: date, source: contradicted
        });
      } else {
        add(findings, 'date_unsupported', 'minor', `${date}|${sentence}`, `Date ${date} does not appear in any stored source`, { date });
      }
    }
  }
}

function claimFindings(script, findings) {
  const blobs = script.sources.map(source => ({ id: source.id, text: sourceBlob(source) }));
  for (const claim of script.claims || []) {
    const text = claim.text || '';
    if (!text.trim()) continue;
    if (extractQuotes(text).length || extractNumbers(text).length || extractDates(text).length) continue;
    let best = 0;
    let bestId = null;
    for (const source of blobs) {
      const score = overlap(text, source.text);
      if (score > best) { best = score; bestId = source.id; }
    }
    if (best < 0.6) {
      add(findings, 'unsupported_claim', 'major', `${claim.id || ''}|${text}`, `Claim is not supported by stored sources (word overlap ${best.toFixed(2)})`, {
        claimId: claim.id || null, overlap: +best.toFixed(3), nearestSource: bestId
      });
    }
  }
}

function sourceFindings(script, findings) {
  const ids = new Set(script.sources.map(source => source.id));
  const cited = new Set(script.citations || []);
  for (const image of script.images || []) if (image.sourceId) cited.add(image.sourceId);
  for (const id of cited) {
    if (!ids.has(id)) {
      add(findings, 'mismatched_source', 'major', id, `Cited source ${id} is not in the stored sources`, { sourceId: id });
    }
  }
  for (const source of script.sources) {
    if (!sourceAlive(source)) {
      add(findings, 'dead_source', 'major', source.id, `Source ${source.id} is not a live stored document (${source.error || source.status || 'empty'})`, {
        sourceId: source.id, url: source.url || null, status: source.status == null ? null : source.status, error: source.error || null
      });
    }
  }
}

function imageFindings(script, findings) {
  const byId = new Map(script.sources.map(source => [source.id, source]));
  for (const image of script.images || []) {
    const source = byId.get(image.sourceId);
    if (!source) continue;
    const blob = sourceBlob(source);
    const caption = image.caption || '';
    for (const date of extractDates(caption)) {
      if (!extractDates(blob).includes(date)) {
        add(findings, 'image_mismatch', 'major', `${image.id}|date|${date}`, `Image ${image.id} caption date ${date} is not in source ${source.id}`, {
          imageId: image.id, sourceId: source.id, date
        });
      }
    }
    for (const num of extractNumbers(caption)) {
      const ok = extractNumbers(blob).some(other => sameNumber(other.value, num.value));
      if (!ok) {
        add(findings, 'image_mismatch', 'major', `${image.id}|num|${num.value}`, `Image ${image.id} caption number ${num.display} is not in source ${source.id}`, {
          imageId: image.id, sourceId: source.id, display: num.display
        });
      }
    }
    const proper = caption.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
    for (const token of proper) {
      if (extractDates(caption).length && new RegExp(token, 'i').test(caption) && MONTH_NAMES.has(token.toLowerCase())) continue;
      if (!blob.includes(token)) {
        add(findings, 'image_mismatch', 'major', `${image.id}|token|${token}`, `Image ${image.id} caption mentions ${token}, which is not in source ${source.id}`, {
          imageId: image.id, sourceId: source.id, token
        });
      }
    }
    if (image.credit && source.name) {
      const credit = image.credit.toLowerCase();
      const name = source.name.toLowerCase();
      if (!credit.includes(name) && !name.includes(credit)) {
        add(findings, 'image_credit', 'minor', `${image.id}|${image.credit}|${source.name}`, `Image ${image.id} credit “${image.credit}” does not match source name “${source.name}”`, {
          imageId: image.id, credit: image.credit, sourceName: source.name
        });
      }
    }
    if (image.takenAt) {
      const taken = String(image.takenAt).slice(0, 10);
      const sourceDates = extractDates(blob);
      if (/^\d{4}-\d{2}-\d{2}$/.test(taken) && sourceDates.length && !sourceDates.includes(taken)) {
        add(findings, 'image_mismatch', 'major', `${image.id}|taken|${taken}`, `Image ${image.id} takenAt ${taken} is not a date in source ${source.id}`, {
          imageId: image.id, takenAt: taken, sourceDates
        });
      }
    }
    if (image.file) {
      if (!fs.existsSync(image.file)) {
        add(findings, 'image_file_missing', 'major', image.file, `Image file is missing: ${image.file}`, { imageId: image.id, file: image.file });
      } else {
        try {
          const info = probeMedia(image.file);
          const created = info.format && info.format.tags && (info.format.tags.creation_time || info.format.tags.date);
          if (created && image.takenAt && String(created).slice(0, 10) !== String(image.takenAt).slice(0, 10)) {
            add(findings, 'image_mismatch', 'major', `${image.id}|exif|${created}`, `Embedded creation time ${String(created).slice(0, 10)} does not match takenAt ${String(image.takenAt).slice(0, 10)}`, {
              imageId: image.id, creationTime: created, takenAt: image.takenAt
            });
          }
        } catch (error) {
          add(findings, 'image_unreadable', 'minor', image.file, `ffprobe could not read ${image.file}: ${error.message}`, { imageId: image.id });
        }
      }
    }
  }
}

const MONTH_NAMES = new Set('january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));

function videoFindings(script, findings) {
  if (!script.video) return;
  if (!script.video.file || !fs.existsSync(script.video.file)) {
    add(findings, 'video_file_missing', 'major', script.video.file || script.id, 'Video file is missing', { file: script.video.file || null });
    return;
  }
  const report = inspectVideo(script.video.file, script.video.expected || {});
  script._videoMetrics = report.metrics;
  for (const item of report.findings) {
    add(findings, item.kind, item.severity, `${script.video.file}|${item.kind}|${item.summary}`, item.summary, item.evidence);
  }
}

export function decide(findings) {
  if (findings.some(item => item.severity === 'blocker' || item.severity === 'major')) return 'hold';
  if (findings.length) return 'clear_with_notes';
  return 'clear';
}

export function reviewScript(script) {
  assertScript(script);
  const findings = [];
  const text = scannedText(script);
  sourceFindings(script, findings);
  quoteFindings(text, script.sources, findings);
  numberFindings(text, script.sources, findings);
  dateFindings(text, script.sources, findings);
  claimFindings(script, findings);
  imageFindings(script, findings);
  videoFindings(script, findings);
  const decision = decide(findings);
  const counts = { blocker: 0, major: 0, minor: 0 };
  for (const item of findings) counts[item.severity] = (counts[item.severity] || 0) + 1;
  return {
    contract: 'moonkatty.qa.content.verdict/1',
    scriptId: script.id,
    checkedAt: new Date().toISOString(),
    decision,
    publish: decision !== 'hold',
    findings,
    counts,
    video: script._videoMetrics || null,
    note: 'decision is a publish gate from the findings above. It is not a quality score.'
  };
}

export async function reviewScriptLive(script, { fetchImpl } = {}) {
  assertScript(script);
  const sources = await probeSources(script.sources, fetchImpl);
  return reviewScript({ ...script, sources });
}
