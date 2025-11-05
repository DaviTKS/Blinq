export function parseCsvDate(dateStr) {
  if (!dateStr) return new Date();
  const s = dateStr.trim();
  let y, m, d;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split('/');
    y = parseInt(yyyy, 10); m = parseInt(mm, 10) - 1; d = parseInt(dd, 10);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yyyy, mm, dd] = s.split('-');
    y = parseInt(yyyy, 10); m = parseInt(mm, 10) - 1; d = parseInt(dd, 10);
  } else {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) return parsed;
    return new Date();
  }
  return new Date(Date.UTC(y, m, d, 12, 0, 0));
}

export function parseCsv(content) {
  const result = [];
  if (!content) return result;
  const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return result;

  const headerLine = lines[0];
  const sep = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
  const headers = headerLine.split(sep).map(h => h.trim().toLowerCase());

  const findIdx = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));
  const idxDate = findIdx('data', 'date');
  const idxDesc = findIdx('descri', 'desc', 'histor', 'memo', 'name');
  const idxVal = findIdx('valor', 'amount', 'valor r', 'value');
  const idxType = findIdx('tipo', 'type');

  const startAt = idxDate >= 0 || idxDesc >= 0 || idxVal >= 0 ? 1 : 0;

  for (let i = startAt; i < lines.length; i++) {
    const raw = lines[i];
    const cols = raw.split(sep);
    if (cols.length < 2) continue;
    const getCol = (idx, fallbackIdx) => {
      if (idx >= 0 && idx < cols.length) return cols[idx].trim();
      if (fallbackIdx >= 0 && fallbackIdx < cols.length) return cols[fallbackIdx].trim();
      return '';
    };

    const dateStr = startAt === 0 ? cols[0] : getCol(idxDate, -1);
    const descStr = startAt === 0 ? (cols[1] || '') : getCol(idxDesc, -1);
    const valStr = startAt === 0 ? (cols[2] || '') : getCol(idxVal, -1);
    const typeStr = startAt === 0 ? (cols[3] || '') : getCol(idxType, -1);

    let norm = (valStr || '').replace(/\s/g, '');
    if (/^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(norm)) {
      norm = norm.replace(/\./g, '').replace(',', '.');
    } else {
      norm = norm.replace(/,/g, '');
    }
    const amount = parseFloat(norm);
    if (!amount || isNaN(amount)) continue;

    const tipo = (typeStr || '').toLowerCase().includes('receb') || amount > 0 ? 'receber' : 'pagar';
    const dataVencimento = parseCsvDate(dateStr);
    const descricao = descStr || 'Sem descrição';

    result.push({ descricao, valor: Math.abs(amount), tipo, dataVencimento });
  }
  return result;
}




