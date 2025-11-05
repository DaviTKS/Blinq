export const CATEGORY_RULES = {
  pagar: {
    "Outros": ["mercado pago"],
    "Alimentação": ["atacad","pizza", "hamburg", "mercado", "choco", "mercadinho", "supermercado", "ifood", "rappi", "padaria", "restaurante", "zé delivery", "açougue", "hortifruti"],
    "Transporte": ["uber", "99", "99pop", "99app", "combust", "posto", "ipiranga", "shell", "estaciona"],
    "Moradia": ["aluguel", "condom", "condomínio", "aluguer"],
    "Saúde": ["farmácia", "farmacia", "drogasil", "drogaria", "panvel", "consulta", "laboratório", "laboratorio", "exame"],
    "Lazer": ["netflix", "spotify", "prime video", "disney+", "cinema", "ingresso"],
    "Contas": ["fatura", "energia", "luz", "enel", "cpfl", "água", "agua", "sabesp", "internet", "vivo", "claro", "tim", "oi", "iptu", "ipva"],
    "Beleza": ["barbearia", "salão", "unhas", "cabeleireiro"],
    "Compras Online": ["shp", "ml", "meli", "mercado livre", "ali", "shein"]
  },
  receber: {
    "Salário": ["salário", "salario", "pagamento", "holerite"],
    "Freelance": ["freela", "freelance", "serviço", "servico", "pix cliente", "pagamento cliente"],
    "Investimentos": ["rend", "dividend", "juros"],
    "Presente": ["presente", "doação", "doacao"]
  }
};

export function normalizeTextForMatch(text) {
  return (text || '').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

export function guessCategory(descricao, tipo) {
  const typeKey = (tipo === 'receber') ? 'receber' : 'pagar';
  const rules = CATEGORY_RULES[typeKey] || {};
  const desc = normalizeTextForMatch(descricao);
  for (const [categoria, keywords] of Object.entries(rules)) {
    if (keywords.some(k => desc.includes(normalizeTextForMatch(k)))) {
      return categoria;
    }
  }
  return 'Outros';
}


