export function parseOfxDate(ofxDate) {
  if (!ofxDate) return new Date();
  let digits = ofxDate.replace(/[^0-9]/g, '');
  if (digits.length === 13) {
    digits = '2' + digits;
  }
  if (digits.length < 8) return new Date();
  const y = parseInt(digits.slice(0, 4), 10);
  const m = parseInt(digits.slice(4, 6), 10) - 1;
  const d = parseInt(digits.slice(6, 8), 10);
  const hh = digits.length >= 10 ? parseInt(digits.slice(8, 10), 10) : 12;
  const mm = digits.length >= 12 ? parseInt(digits.slice(10, 12), 10) : 0;
  const ss = digits.length >= 14 ? parseInt(digits.slice(12, 14), 10) : 0;
  const safeYear = y < 1900 ? (2000 + (y % 100)) : y;
  return new Date(Date.UTC(safeYear, m, d, hh, mm, ss));
}

export function parseOfx(content) {
  const entries = [];
  const stmtRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;
  while ((match = stmtRegex.exec(content)) !== null) {
    const block = match[1];
    const getTag = (tag) => {
      const r = new RegExp(`<${tag}>\\s*([^\r\n<]+)`, 'i');
      const m = block.match(r);
      return m ? m[1].trim() : '';
    };
    const trnType = (getTag('TRNTYPE') || '').toUpperCase();
    const trnAmtStr = getTag('TRNAMT');
    const trnAmt = parseFloat(trnAmtStr?.replace(',', '.') || '0');
    const dtPosted = getTag('DTPOSTED');
    const memo = getTag('MEMO') || getTag('NAME') || 'Sem descrição';

    const isCredit = trnType.includes('CREDIT') || trnType.includes('DEP') || trnAmt > 0;
    const tipo = isCredit ? 'receber' : 'pagar';
    const valor = Math.abs(trnAmt);
    const dataVencimento = parseOfxDate(dtPosted);

    if (!valor || isNaN(valor)) continue;

    entries.push({ descricao: memo, valor, tipo, dataVencimento });
  }
  return entries;
}




