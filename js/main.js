import {
  app, auth, db,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  doc, getDoc, setDoc, collection, addDoc, onSnapshot, deleteDoc, updateDoc,
  query, where, writeBatch, Timestamp, serverTimestamp, runTransaction,
  appId, isEnvironment
} from './firebase.js';

import { parseOfx } from './importers/ofx.js';
import { parseCsv } from './importers/csv.js';
import { guessCategory } from './categorization.js';

// --- VARIÁVEIS GLOBAIS ---
let currentUser = null;
let currentUserId = null;
let currentUserProfile = null;
let transacoesRef = null;
let unsubscribeTransactions = null;
let unsubscribePendingUsers = null;
let unsubscribeAllUsers = null;
let chartInstance = null;
let monthlyChartInstance = null;
let allTransactions = [];
let latestFilteredTransactions = [];

const CATEGORIAS = {
  pagar: ["Alimentação", "Moradia", "Transporte", "Lazer", "Saúde", "Beleza","Contas", "Compras Online","Investimentos", "Outros"],
  receber: ["Salário", "Freelance", "Investimentos", "Presente", "Outros"]
};

// --- ELEMENTOS DO DOM ---
let loadingOverlay, loginScreen, pendingScreen, appScreen, adminScreen;
let loginBtn, logoutBtnPending, logoutBtnMain, logoutBtnAdmin;
let transactionForm, formDescricao, formValor, formCategoria, formTipo, formData;
let transactionsTableBody, transactionsCards, totalReceberEl, totalPagarEl, saldoAtualEl;
let pendingUsersList, allUsersList;
let userNameEl, userEmailEl, userPhotoEl;
let adminNameEl, adminEmailEl, adminPhotoEl;
let loginErrorEl, toaster;
let modalBackdrop, modalTitle, modalText, modalCancel, modalOk;
let editModalBackdrop, editDescricao, editValor, editCategoria, editTipo, editData, editCancelBtn, editSaveBtn;
let currentEditId = null;
let editMode = false;
let editModeBtn;
let editModeBanner, editModeClose;
let searchInput, filterStartDate, filterEndDate, clearFiltersBtn, categoryChartCanvas, monthlyChartCanvas;
let applyFiltersBtn, toggleFiltersBtn, filtersPanel;
let tabPendentesBtn, tabConcluidosBtn, tabPendentesCountEl, tabConcluidosCountEl, currentStatusFilter = 'pendentes';
let couponInput, applyCouponBtn, couponMessage;
let ofxFileInput, selectOfxBtn, importOfxBtn, ofxFileName;
let clearOfxBtn;
let ofxPreviewEl, ofxPreviewBody, ofxPreviewCount, ofxPreviewNote;
let ofxParsedEntries = [];

function updateAdminToggleVisibility() {
  try {
    const btn = document.getElementById('go-to-admin-btn');
    if (!btn) return;
    const isAdmin = !!(currentUserProfile && currentUserProfile.role === 'admin');
    // Sempre escondido no mobile
    btn.classList.add('hidden');
    // Controla visibilidade em telas md+ via classes responsivas
    if (isAdmin) {
      btn.classList.remove('md:hidden');
      btn.classList.add('md:inline-block');
    } else {
      btn.classList.remove('md:inline-block');
      btn.classList.add('md:hidden');
    }
  } catch {}
}

// --- UI HELPERS ---
function showToast(message, type = 'success') {
  if (!toaster) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'success' ? 'toast-success' : 'toast-error'}`;
  toast.textContent = message;
  const isEditHint = (message || '').toLowerCase().includes('modo edição');
  // Sucessos: não remover o toast fixo do modo de edição
  if (type === 'success') {
    const prev = toaster.querySelectorAll('.toast-success');
    prev.forEach(p => {
      const txt = (p.textContent || '').toLowerCase();
      if (!txt.includes('modo edição')) {
        toaster.contains(p) && toaster.removeChild(p);
      }
    });
  }
  toaster.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 100);
  const remove = () => {
    toast.classList.remove('show');
    setTimeout(() => toaster.contains(toast) && toaster.removeChild(toast), 300);
  };
  // Clique para fechar em qualquer tipo
  toast.style.cursor = 'pointer';
  toast.title = 'Clique para fechar';
  toast.addEventListener('click', remove);
  // Auto-fechar após 3s para todos, exceto o aviso de modo de edição
  if (!isEditHint) {
    setTimeout(remove, 3000);
  }
}

function setLoading(show) { return; }

function showConfirmModal(title, text, okText = 'Confirmar') {
  return new Promise((resolve) => {
    modalTitle.textContent = title;
    modalText.textContent = text;
    modalOk.textContent = okText;
    const newModalOk = modalOk.cloneNode(true);
    modalOk.parentNode.replaceChild(newModalOk, modalOk);
    modalOk = newModalOk;
    const newModalCancel = modalCancel.cloneNode(true);
    modalCancel.parentNode.replaceChild(newModalCancel, modalCancel);
    modalCancel = newModalCancel;
    modalBackdrop.classList.add('visible');
    modalOk.onclick = () => { modalBackdrop.classList.remove('visible'); resolve(true); };
    modalCancel.onclick = () => { modalBackdrop.classList.remove('visible'); resolve(false); };
  });
}

function formatCurrency(value) {
  if (typeof value !== 'number') value = 0;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatCurrencyInput(value) {
  let digits = value.replace(/\D/g, '');
  if (digits === '') digits = '0';
  return (parseInt(digits, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateInput) {
  try {
    if (!dateInput) return 'N/A';
    let date;
    if (dateInput.toDate) {
      date = dateInput.toDate();
    } else if (dateInput instanceof Date) {
      date = dateInput;
    } else {
      const parts = dateInput.split('-');
      date = new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  } catch {
    return 'Data Inválida';
  }
}

function renderOfxPreview(entries) {
  if (!ofxPreviewEl || !ofxPreviewBody || !ofxPreviewCount || !ofxPreviewNote) return;
  if (!entries || entries.length === 0) {
    ofxPreviewEl.classList.add('hidden');
    ofxPreviewBody.innerHTML = '';
    ofxPreviewCount.textContent = '';
    ofxPreviewNote.textContent = '';
    return;
  }
  ofxPreviewEl.classList.remove('hidden');
  ofxPreviewCount.textContent = `${entries.length} lançamento(s)`;
  const maxRows = 50;
  const rows = entries.slice(0, maxRows).map((t) => {
    const valorClasse = t.tipo === 'receber' ? 'text-green-600' : 'text-red-600';
    return `
      <tr>
        <td class="px-3 py-2 whitespace-normal break-words text-sm text-gray-900">${t.descricao}</td>
        <td class="px-3 py-2 whitespace-nowrap text-sm ${valorClasse}">${formatCurrency(t.valor)}</td>
        <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-500">${t.tipo === 'receber' ? 'A Receber' : 'A Pagar'}</td>
        <td class="px-3 py-2 whitespace-nowrap text-sm text-gray-500">${formatDate(t.dataVencimento)}</td>
      </tr>`;
  }).join('');
  ofxPreviewBody.innerHTML = rows;
  ofxPreviewNote.textContent = entries.length > maxRows ? `Mostrando ${maxRows} de ${entries.length}. O restante será importado.` : '';
}

function resetOfxUI() {
  ofxParsedEntries = [];
  if (ofxFileInput) ofxFileInput.value = '';
  if (ofxFileName) ofxFileName.textContent = '';
  renderOfxPreview([]);
  if (importOfxBtn) {
    importOfxBtn.disabled = true;
    importOfxBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700', 'hover:scale-105');
    importOfxBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
  }
  if (clearOfxBtn) {
    clearOfxBtn.disabled = true;
    clearOfxBtn.classList.add('cursor-not-allowed');
  }
}

async function saveOfxTransactions(txs) {
  if (!transacoesRef) { showToast('Erro: sessão não iniciada ou sem acesso às transações.', 'error'); return; }
  if (!txs.length) { showToast('Nenhum lançamento válido encontrado no OFX.', 'error'); return; }
  const batch = writeBatch(db);
  txs.forEach((t) => {
    const [y, m, d] = [t.dataVencimento.getUTCFullYear(), t.dataVencimento.getUTCMonth(), t.dataVencimento.getUTCDate()];
    const ts = Timestamp.fromDate(new Date(Date.UTC(y, m, d)));
    const docRef = doc(transacoesRef);
    batch.set(docRef, {
      descricao: t.descricao,
      valor: t.valor,
      categoria: guessCategory(t.descricao, t.tipo),
      tipo: t.tipo,
      dataVencimento: ts,
      status: 'pendente',
      createdAt: serverTimestamp()
    });
  });
  await batch.commit();
}

async function handleImportOfxFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const txs = parseOfx(text);
    if (!txs.length) { showToast('Arquivo OFX sem lançamentos reconhecíveis.', 'error'); return; }
    const confirmed = await showConfirmModal('Importar OFX', `Encontrados ${txs.length} lançamentos. Deseja importar?`, 'Importar');
    if (!confirmed) return;
    setLoading(true);
    await saveOfxTransactions(txs);
    showToast('OFX importado com sucesso!', 'success');
    ofxFileInput.value = '';
    ofxFileName.textContent = '';
    importOfxBtn.disabled = true;
    importOfxBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700', 'hover:scale-105');
    importOfxBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
  } catch (err) {
    showToast(`Erro ao importar OFX: ${err.message}`, 'error');
  } finally { setLoading(false); }
}

function cleanupListeners() {
  if (unsubscribeTransactions) { unsubscribeTransactions(); unsubscribeTransactions = null; }
  if (unsubscribePendingUsers) { unsubscribePendingUsers(); unsubscribePendingUsers = null; }
  if (unsubscribeAllUsers) { unsubscribeAllUsers(); unsubscribeAllUsers = null; }
}

function clearUI() {
  if (transactionsTableBody) {
    transactionsTableBody.innerHTML = '<tr><td colspan="7" class="px-6 py-4 text-center text-gray-500">Nenhum lançamento encontrado.</td></tr>';
  }
  if (transactionsCards) {
    transactionsCards.innerHTML = '';
  }
  try { const gt = document.getElementById('global-totals'); if (gt) gt.innerHTML = ''; } catch {}
  if (totalReceberEl) totalReceberEl.textContent = formatCurrency(0);
  if (totalPagarEl) totalPagarEl.textContent = formatCurrency(0);
  if (saldoAtualEl) saldoAtualEl.textContent = formatCurrency(0);
  if (pendingUsersList) pendingUsersList.innerHTML = '<p class="text-gray-500">Nenhum utilizador pendente.</p>';
  if (allUsersList) allUsersList.innerHTML = '<p class="text-gray-500">A carregar lista de utilizadores...</p>';
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
  if (monthlyChartInstance) { monthlyChartInstance.destroy(); monthlyChartInstance = null; }
  if (categoryChartCanvas) {
    const ctx = categoryChartCanvas.getContext('2d');
    ctx.clearRect(0, 0, categoryChartCanvas.width, categoryChartCanvas.height);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6b7280';
    ctx.font = '16px Inter';
    ctx.fillText('A carregar dados...', categoryChartCanvas.width / 2, categoryChartCanvas.height / 2);
  }
  if (monthlyChartCanvas) {
    const ctx2 = monthlyChartCanvas.getContext('2d');
    ctx2.clearRect(0, 0, monthlyChartCanvas.width, monthlyChartCanvas.height);
    ctx2.textAlign = 'center';
    ctx2.fillStyle = '#6b7280';
    ctx2.font = '16px Inter';
    ctx2.fillText('A carregar dados...', monthlyChartCanvas.width / 2, monthlyChartCanvas.height / 2);
  }
}

function navigateTo(screenName) {
  if (loginScreen) loginScreen.classList.add('hidden');
  if (pendingScreen) pendingScreen.classList.add('hidden');
  if (appScreen) appScreen.classList.add('hidden');
  if (adminScreen) adminScreen.classList.add('hidden');
  switch (screenName) {
    case 'login': if (loginScreen) loginScreen.classList.remove('hidden'); break;
    case 'pending': if (pendingScreen) pendingScreen.classList.remove('hidden'); break;
    case 'app': if (appScreen) appScreen.classList.remove('hidden'); break;
    case 'admin': if (adminScreen) adminScreen.classList.remove('hidden'); break;
  }
}

async function initialize() {
  try {
    logoutBtnPending.addEventListener('click', handleLogout);
    logoutBtnMain.addEventListener('click', handleLogout);
    logoutBtnAdmin.addEventListener('click', handleLogout);
    loginBtn.addEventListener('click', handleLogin);
    applyCouponBtn.addEventListener('click', handleApplyCoupon);
    const goToAppBtn = document.getElementById('go-to-app-btn');
    if (goToAppBtn) {
      goToAppBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          cleanupListeners();
          navigateTo('app');
          if (currentUser) { setupAppUI(currentUser); listenForTransactions(); }
          updateAdminToggleVisibility();
        } catch (err) { showToast(`Erro ao abrir app: ${err.message}`, 'error'); }
      });
    }
    const goToAdminBtn = document.getElementById('go-to-admin-btn');
    if (goToAdminBtn) {
      goToAdminBtn.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          cleanupListeners();
          navigateTo('admin');
          if (currentUser) { setupAdminUI(currentUser); listenForPendingUsers(); listenForAllUsers(); }
        } catch (err) { showToast(`Erro ao abrir admin: ${err.message}`, 'error'); }
      });
    }

    onAuthStateChanged(auth, async (user) => {
      try {
        cleanupListeners();
        clearUI();
        if (user && !user.isAnonymous) {
          currentUser = user;
          currentUserId = user.uid;
          await checkUserProfile(user);
        } else {
          currentUser = null; currentUserId = null; currentUserProfile = null; navigateTo('login');
        }
      } catch (error) {
        showToast(`Erro crítico: ${error.message}`, 'error');
        navigateTo('login');
      }
    });

    transactionForm.addEventListener('submit', handleAddTransaction);
    document.body.addEventListener('click', handleListActions);
    formValor.addEventListener('input', (e) => {
      const target = e.target;
      let formattedValue = formatCurrencyInput(target.value);
      target.value = formattedValue;
      target.setSelectionRange(formattedValue.length, formattedValue.length);
    });

    function populateCategories() {
      const tipo = formTipo.value; const cats = CATEGORIAS[tipo];
      formCategoria.innerHTML = '';
      cats.forEach(cat => { const option = document.createElement('option'); option.value = cat; option.textContent = cat; formCategoria.appendChild(option); });
    }
    formTipo.addEventListener('change', populateCategories);
    populateCategories();

    // Filtro padrão: do último dia do mês anterior ao último dia do mês atual (se não definido)
    try {
      if (filterStartDate && filterEndDate && !filterStartDate.value && !filterEndDate.value) {
        const now = new Date();
        const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0); // dia 0 do mês atual = último do mês anterior
        const currentMonthLastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        filterStartDate.value = toYmd(prevMonthLastDay);
        filterEndDate.value = toYmd(currentMonthLastDay);
      }
    } catch {}

    searchInput.addEventListener('input', applyFilters);
    filterStartDate.addEventListener('input', applyFilters);
    filterEndDate.addEventListener('input', applyFilters);
    const applyFiltersBtn = document.getElementById('apply-filters-btn');
    if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', (e)=>{ e.preventDefault(); applyFilters(); });
    clearFiltersBtn.addEventListener('click', () => { searchInput.value=''; filterStartDate.value=''; filterEndDate.value=''; applyFilters(); });
    // Toggle de filtros no mobile
    const toggleFiltersBtn = document.getElementById('toggle-filters-btn');
    const filtersPanel = document.getElementById('filters-panel');
    if (toggleFiltersBtn && filtersPanel) {
      toggleFiltersBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const isHidden = filtersPanel.classList.contains('hidden');
        if (isHidden) {
          filtersPanel.classList.remove('hidden');
          toggleFiltersBtn.setAttribute('aria-expanded', 'true');
        } else {
          filtersPanel.classList.add('hidden');
          toggleFiltersBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Tabs de status (Pendentes / Concluídos)
    tabPendentesBtn = document.getElementById('tab-pendentes');
    tabConcluidosBtn = document.getElementById('tab-concluidos');
    tabPendentesCountEl = document.getElementById('tab-pendentes-count');
    tabConcluidosCountEl = document.getElementById('tab-concluidos-count');
    function updateTabUI() {
      if (tabPendentesBtn && tabConcluidosBtn) {
        if (currentStatusFilter === 'pendentes') {
          tabPendentesBtn.classList.add('bg-indigo-600','text-white','shadow','ring-1','ring-indigo-600');
          tabPendentesBtn.setAttribute('aria-pressed','true');
          tabPendentesBtn.classList.add('tab-active');
          tabConcluidosBtn.classList.remove('bg-indigo-600','text-white','shadow','ring-1','ring-indigo-600');
          tabConcluidosBtn.classList.add('text-indigo-800');
          tabConcluidosBtn.setAttribute('aria-pressed','false');
          tabConcluidosBtn.classList.remove('tab-active');
        } else {
          tabConcluidosBtn.classList.add('bg-indigo-600','text-white','shadow','ring-1','ring-indigo-600');
          tabConcluidosBtn.setAttribute('aria-pressed','true');
          tabConcluidosBtn.classList.add('tab-active');
          tabPendentesBtn.classList.remove('bg-indigo-600','text-white','shadow','ring-1','ring-indigo-600');
          tabPendentesBtn.classList.add('text-indigo-800');
          tabPendentesBtn.setAttribute('aria-pressed','false');
          tabPendentesBtn.classList.remove('tab-active');
        }
      }
    }
    if (tabPendentesBtn) tabPendentesBtn.addEventListener('click', (e)=>{ e.preventDefault(); currentStatusFilter='pendentes'; updateTabUI(); applyFilters(); });
    if (tabConcluidosBtn) tabConcluidosBtn.addEventListener('click', (e)=>{ e.preventDefault(); currentStatusFilter='concluidos'; updateTabUI(); applyFilters(); });
    updateTabUI();

    selectOfxBtn.addEventListener('click', (e) => { e.preventDefault(); ofxFileInput.click(); });
    ofxFileInput.addEventListener('change', async () => {
      const file = ofxFileInput.files && ofxFileInput.files[0];
      ofxFileName.textContent = file ? file.name : '';
      ofxParsedEntries = [];
      if (!file) { renderOfxPreview([]); importOfxBtn.disabled = true; importOfxBtn.classList.remove('bg-indigo-600','hover:bg-indigo-700','hover:scale-105'); importOfxBtn.classList.add('bg-gray-400','cursor-not-allowed'); return; }
      try {
        const text = await file.text();
        const lower = file.name.toLowerCase();
        const txs = lower.endsWith('.csv') ? parseCsv(text) : parseOfx(text);
        ofxParsedEntries = txs; renderOfxPreview(txs);
        const enable = txs.length > 0; importOfxBtn.disabled = !enable; clearOfxBtn.disabled = !enable;
        if (enable) {
          importOfxBtn.classList.remove('bg-gray-400','cursor-not-allowed'); importOfxBtn.classList.add('bg-indigo-600','hover:bg-indigo-700','hover:scale-105'); clearOfxBtn.classList.remove('cursor-not-allowed');
          showToast(`Detectados ${txs.length} lançamento(s). Revise e clique em Importar.`, 'success');
        } else {
          importOfxBtn.classList.remove('bg-indigo-600','hover:bg-indigo-700','hover:scale-105'); importOfxBtn.classList.add('bg-gray-400','cursor-not-allowed'); clearOfxBtn.classList.add('cursor-not-allowed'); showToast('Nenhum lançamento reconhecido no arquivo.', 'error');
        }
      } catch (e) {
        renderOfxPreview([]); importOfxBtn.disabled = true; importOfxBtn.classList.remove('bg-indigo-600','hover:bg-indigo-700','hover:scale-105'); importOfxBtn.classList.add('bg-gray-400','cursor-not-allowed'); clearOfxBtn.disabled = true; clearOfxBtn.classList.add('cursor-not-allowed'); showToast('Erro ao ler o arquivo.', 'error');
      }
    });
    importOfxBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (ofxParsedEntries && ofxParsedEntries.length > 0) {
        const confirmed = await showConfirmModal('Importar', `Importar ${ofxParsedEntries.length} lançamento(s)?`, 'Importar');
        if (!confirmed) return;
        try { setLoading(true); await saveOfxTransactions(ofxParsedEntries); showToast('Importado com sucesso!', 'success'); resetOfxUI(); }
        catch (err) { showToast(`Erro ao importar: ${err.message}`, 'error'); }
        finally { setLoading(false); }
      }
    });

    const quitarTudoBtn = document.getElementById('quitar-tudo-btn');
    if (quitarTudoBtn) quitarTudoBtn.addEventListener('click', async (e)=>{e.preventDefault(); await handleQuitarTudo();});
    const excluirTudoBtn = document.getElementById('excluir-tudo-btn');
    if (excluirTudoBtn) excluirTudoBtn.addEventListener('click', async (e)=>{e.preventDefault(); await handleExcluirTudo();});
    clearOfxBtn.addEventListener('click', (e)=>{ e.preventDefault(); resetOfxUI(); showToast('Importação cancelada.', 'success'); });

    function applyEditModeUI(on) {
      if (!editModeBtn) return;
      if (on) {
        editModeBtn.classList.remove('bg-gray-500');
        editModeBtn.classList.add('bg-indigo-600');
        if (transactionsTableBody) transactionsTableBody.classList.add('edit-mode');
        if (transactionsCards) transactionsCards.classList.add('edit-mode');
        if (window.matchMedia('(max-width: 640px)').matches && editModeBanner) {
          editModeBanner.classList.remove('hidden');
        }
        if (!window.matchMedia('(max-width: 640px)').matches) {
          showToast('Modo edição: clique numa linha para editar.', 'success');
        }
      } else {
        editModeBtn.classList.remove('bg-indigo-600');
        editModeBtn.classList.add('bg-gray-500');
        if (transactionsTableBody) transactionsTableBody.classList.remove('edit-mode');
        if (transactionsCards) transactionsCards.classList.remove('edit-mode');
        if (editModeBanner) editModeBanner.classList.add('hidden');
        try {
          const hint = 'Modo edição: clique numa linha para editar.';
          const successToasts = toaster ? Array.from(toaster.querySelectorAll('.toast-success')) : [];
          successToasts.forEach(t => {
            if ((t.textContent || '').trim() === hint) {
              t.classList.remove('show');
              setTimeout(() => toaster.contains(t) && toaster.removeChild(t), 300);
            }
          });
        } catch {}
      }
    }

    if (editModeBtn) {
      editModeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        editMode = !editMode;
        applyEditModeUI(editMode);
      });
    }
    if (editModeClose) {
      editModeClose.addEventListener('click', (e) => {
        e.preventDefault();
        if (!editMode) return;
        editMode = false;
        applyEditModeUI(false);
      });
    }

    if (transactionsTableBody) {
      transactionsTableBody.addEventListener('click', (e) => {
        if (!editMode) return;
        if (e.target.closest('button')) return; // não interferir com outros botões
        const tr = e.target.closest('tr');
        if (!tr) return;
        const id = tr.getAttribute('data-id');
        if (id) openEditModal(id);
      });
    }

    if (transactionsCards) {
      transactionsCards.addEventListener('click', (e) => {
        if (!editMode) return;
        if (e.target.closest('button')) return;
        const card = e.target.closest('.tx-card');
        if (!card) return;
        const id = card.getAttribute('data-id');
        if (id) openEditModal(id);
      });
    }

  } catch (error) {
    navigateTo('login'); loginErrorEl.textContent = `Erro fatal: ${error.message}`; loginErrorEl.classList.remove('hidden');
  }
}

async function handleLogin() {
  setLoading(true); loginErrorEl.classList.add('hidden');
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); showToast('Login bem-sucedido!', 'success'); }
  catch (error) { showToast(`Erro ao logar: ${error.message}`, 'error'); loginErrorEl.textContent = 'Erro ao tentar fazer login. Tente novamente.'; loginErrorEl.classList.remove('hidden'); setLoading(false); }
}

async function handleLogout() {
  setLoading(true); try { await signOut(auth); showToast('Logout realizado com sucesso!', 'success'); } catch (error) { showToast(`Erro ao sair: ${error.message}`, 'error'); } finally { setLoading(false); }
}

async function handleApplyCoupon() {
  if (!currentUserId) { showToast('Erro: Você precisa estar logado para aplicar um cupom.', 'error'); return; }
  const couponCode = couponInput.value.trim();
  couponMessage.textContent = '';
  if (couponCode !== 'Blinq2025') { couponMessage.textContent = 'Cupom inválido.'; couponMessage.classList.remove('text-green-600'); couponMessage.classList.add('text-red-500'); return; }
  setLoading(true);
  try {
    const userRef = isEnvironment ? doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', currentUserId) : doc(db, 'user_profiles', currentUserId);
    const couponStatsRef = isEnvironment ? doc(db, 'artifacts', appId, 'public', 'data', 'metadata', 'coupon_stats') : doc(db, 'metadata', 'coupon_stats');
    await runTransaction(db, async (transaction) => {
      const couponDoc = await transaction.get(couponStatsRef);
      let currentUses = couponDoc.exists() ? (couponDoc.data().uses || 0) : 0;
      if (currentUses >= 5) throw new Error('Limite do cupom atingido!');
      if (couponDoc.exists()) transaction.update(couponStatsRef, { uses: currentUses + 1 }); else transaction.set(couponStatsRef, { uses: 1 });
      transaction.update(userRef, { status: 'approved' });
    });
    showToast('Cupom aplicado! Você foi aprovado.', 'success');
    couponMessage.textContent = 'Aprovado! A redirecionar...';
    couponMessage.classList.remove('text-red-500'); couponMessage.classList.add('text-green-600');
    if (currentUser) await checkUserProfile(currentUser);
  } catch (error) {
    if (error.message === 'Limite do cupom atingido!') { couponMessage.textContent = 'Este cupom já atingiu o limite de 5 utilizações.'; couponMessage.classList.remove('text-green-600'); couponMessage.classList.add('text-red-500'); }
    else { couponMessage.textContent = 'Erro ao aplicar o cupom. Tente novamente.'; couponMessage.classList.remove('text-green-600'); couponMessage.classList.add('text-red-500'); showToast(`Erro: ${error.message}`, 'error'); }
  } finally { setLoading(false); }
}

async function checkUserProfile(user) {
  try {
    const userRef = isEnvironment ? doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', user.uid) : doc(db, 'user_profiles', user.uid);
    const userDoc = await getDoc(userRef);
    if (userDoc.exists()) {
      currentUserProfile = userDoc.data();
      if (currentUserProfile.email !== user.email || currentUserProfile.displayName !== user.displayName) {
        await updateDoc(userRef, { email: user.email, displayName: user.displayName, photoURL: user.photoURL });
      }
      if (currentUserProfile.role === 'admin') { navigateTo('admin'); setupAdminUI(user); listenForPendingUsers(); listenForAllUsers(); }
      else if (currentUserProfile.status === 'approved') { navigateTo('app'); setupAppUI(user); listenForTransactions(); }
      else { navigateTo('pending'); }
      updateAdminToggleVisibility();
    } else {
      const newUserProfile = { displayName: user.displayName, email: user.email, photoURL: user.photoURL, status: 'pending', role: 'user', createdAt: serverTimestamp() };
      await setDoc(userRef, newUserProfile);
      currentUserProfile = newUserProfile; navigateTo('pending'); showToast('Conta criada. Aguardando aprovação.', 'success');
    }
  } catch (error) { showToast(`Erro de perfil: ${error.message}`, 'error'); await handleLogout(); }
  finally { setLoading(false); }
}

// Configura a UI da aplicação principal para utilizadores aprovados
function setupAppUI(user) {
  if (!userNameEl || !userEmailEl || !userPhotoEl) return;
  userNameEl.textContent = `Olá, ${user.displayName}!`;
  userEmailEl.textContent = user.email;
  userPhotoEl.src = user.photoURL || 'https://placehold.co/40x40/gray/white?text=A';
}

function setupAdminUI(user) {
  adminNameEl.textContent = `Admin: ${user.displayName}`;
  adminEmailEl.textContent = user.email;
  adminPhotoEl.src = user.photoURL || 'https://placehold.co/40x40/gray/white?text=A';
}

// --- ADMIN LISTENERS ---
function renderUsersTable(container, users, mode = 'all') {
  if (!container) return;
  if (!users || users.length === 0) {
    container.innerHTML = `<p class="text-gray-500">Nenhum utilizador${mode === 'pending' ? ' pendente' : ''}.</p>`;
    return;
  }
  const rows = users.map(u => {
    const name = u.displayName || '—';
    const email = u.email || '—';
    const status = u.status || '—';
    const created = (u.createdAt && u.createdAt.toDate) ? u.createdAt.toDate().toLocaleDateString('pt-BR') : '—';
    const photo = u.photoURL || 'https://placehold.co/32x32/ddd/555?text=U';
    let actions = '';
    // Aprovar/Recusar para pendentes
    if (mode === 'pending' || status === 'pending') {
      actions += `<button data-action="user-approve" data-uid="${u.id}" class="px-3 py-1 rounded-md bg-green-600 text-white text-xs hover:bg-green-700">Aprovar</button>`;
      actions += `<button data-action="user-reject" data-uid="${u.id}" class="ml-2 px-3 py-1 rounded-md bg-red-600 text-white text-xs hover:bg-red-700">Recusar</button>`;
    }
    // Controles de admin: tornar admin / remover admin / remover acesso
    if (u.role !== 'admin') {
      actions += `${actions ? '<span class=\"mx-2 text-gray-300\">|</span>' : ''}<button data-action=\"user-make-admin\" data-uid=\"${u.id}\" class=\"px-3 py-1 rounded-md bg-indigo-600 text-white text-xs hover:bg-indigo-700\">Tornar Admin</button>`;
      actions += `<button data-action=\"user-revoke\" data-uid=\"${u.id}\" class=\"ml-2 px-3 py-1 rounded-md bg-gray-700 text-white text-xs hover:bg-black\">Remover Acesso</button>`;
    } else {
      actions += `${actions ? '<span class=\"mx-2 text-gray-300\">|</span>' : ''}<button data-action=\"user-remove-admin\" data-uid=\"${u.id}\" class=\"px-3 py-1 rounded-md bg-amber-600 text-white text-xs hover:bg-amber-700\">Remover Admin</button>`;
      actions += `<button data-action=\"user-revoke\" data-uid=\"${u.id}\" class=\"ml-2 px-3 py-1 rounded-md bg-gray-700 text-white text-xs hover:bg-black\">Remover Acesso</button>`;
    }
    return `<tr>
      <td class="px-3 py-2 text-sm text-gray-900"><div class="flex items-center gap-2"><img src="${photo}" class="h-8 w-8 rounded-full" onerror="this.src='https://placehold.co/32x32/ddd/555?text=U'" alt="foto"><span>${name}</span></div></td>
      <td class="px-3 py-2 text-sm text-gray-600">${email}</td>
      <td class="px-3 py-2 text-xs"><span class="inline-flex px-2 py-0.5 rounded-full ${status==='approved'?'bg-green-100 text-green-800':(status==='pending'?'bg-yellow-100 text-yellow-800':'bg-gray-100 text-gray-700')}">${status}</span></td>
      <td class="px-3 py-2 text-sm text-gray-500">${created}</td>
      <td class="px-3 py-2">${actions}</td>
    </tr>`;
  }).join('');
  container.innerHTML = `<div class="overflow-x-auto border border-gray-200 rounded-lg">
    <table class="min-w-full divide-y divide-gray-200">
      <thead class="bg-gray-50">
        <tr>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Utilizador</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Criado em</th>
          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
        </tr>
      </thead>
      <tbody class="bg-white divide-y divide-gray-200">${rows}</tbody>
    </table>
  </div>`;
}

function listenForPendingUsers() {
  try {
    if (unsubscribePendingUsers) { unsubscribePendingUsers(); unsubscribePendingUsers = null; }
    const colRef = isEnvironment ? collection(db, 'artifacts', appId, 'public', 'data', 'user_profiles') : collection(db, 'user_profiles');
    const qref = query(colRef, where('status', '==', 'pending'));
    unsubscribePendingUsers = onSnapshot(qref, (snap) => {
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUsersTable(pendingUsersList, users, 'pending');
    }, (err) => { if (pendingUsersList) pendingUsersList.innerHTML = `<p class=\"text-red-500\">Erro: ${err.message}</p>`; });
  } catch (e) {
    if (pendingUsersList) pendingUsersList.innerHTML = `<p class=\"text-red-500\">Erro: ${e.message}</p>`;
  }
}

function listenForAllUsers() {
  try {
    if (unsubscribeAllUsers) { unsubscribeAllUsers(); unsubscribeAllUsers = null; }
    const colRef = isEnvironment ? collection(db, 'artifacts', appId, 'public', 'data', 'user_profiles') : collection(db, 'user_profiles');
    unsubscribeAllUsers = onSnapshot(colRef, (snap) => {
      const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUsersTable(allUsersList, users);
    }, (err) => { if (allUsersList) allUsersList.innerHTML = `<p class=\"text-red-500\">Erro: ${err.message}</p>`; });
  } catch (e) {
    if (allUsersList) allUsersList.innerHTML = `<p class=\"text-red-500\">Erro: ${e.message}</p>`;
  }
}

function applyFilters() {
  const searchTerm = (searchInput.value || '').toLowerCase();
  const startDate = filterStartDate.value ? new Date(filterStartDate.value + 'T00:00:00') : null;
  const endDate = filterEndDate.value ? new Date(filterEndDate.value + 'T23:59:59') : null;
  // Filtro base: texto + intervalo de datas
  const baseFiltered = allTransactions.filter(tx => {
    const descMatch = (tx.descricao || '').toLowerCase().includes(searchTerm);
    let txDate;
    if (tx.dataVencimento && tx.dataVencimento.toDate) { txDate = tx.dataVencimento.toDate(); }
    else if (typeof tx.dataVencimento === 'string') { const parts = tx.dataVencimento.split('-'); txDate = new Date(parts[0], parts[1] - 1, parts[2]); }
    else { txDate = new Date(tx.dataVencimento); }
    const startDateMatch = !startDate || txDate >= startDate;
    const endDateMatch = !endDate || txDate <= endDate;
    return descMatch && startDateMatch && endDateMatch;
  });
  // Atualiza contadores das abas com base no filtro base
  try {
    const pendentesCount = baseFiltered.filter(tx => tx.status !== 'pago').length;
    const concluidosCount = baseFiltered.filter(tx => tx.status === 'pago').length;
    if (tabPendentesCountEl) tabPendentesCountEl.textContent = pendentesCount;
    if (tabConcluidosCountEl) tabConcluidosCountEl.textContent = concluidosCount;
  } catch {}

  // Tab de status
  const statusFiltered = baseFiltered.filter(tx => currentStatusFilter === 'pendentes' ? tx.status !== 'pago' : tx.status === 'pago');
  latestFilteredTransactions = statusFiltered;
  renderTransactions(statusFiltered);
  updateSummary(statusFiltered);
  try { updateListTotals(statusFiltered); } catch {}
  updateChart(baseFiltered);
  updateMonthlyChart(baseFiltered);
}

function updateListTotals(transacoes) {
  const el = document.getElementById('list-totals');
  if (!el) return;
  if (!transacoes || transacoes.length === 0) { el.innerHTML = '<span class="text-gray-500">Nenhum lançamento para exibir.</span>'; return; }
  const qtd = transacoes.length;
  const totalReceber = transacoes.filter(t => t.tipo === 'receber').reduce((a,b)=>a+(b.valor||0),0);
  const totalPagar = transacoes.filter(t => t.tipo === 'pagar').reduce((a,b)=>a+(b.valor||0),0);
  const saldo = totalReceber - totalPagar;
  el.innerHTML = `
    <span class="inline-flex items-center rounded-md bg-gray-100 px-3 py-1">Itens: <strong class="ml-1">${qtd}</strong></span>
    <span class="inline-flex items-center rounded-md bg-green-100 text-green-800 px-3 py-1">Receber: <strong class="ml-1">${formatCurrency(totalReceber)}</strong></span>
    <span class="inline-flex items-center rounded-md bg-red-100 text-red-800 px-3 py-1">Pagar: <strong class="ml-1">${formatCurrency(totalPagar)}</strong></span>
    <span class="inline-flex items-center rounded-md ${saldo>=0?'bg-emerald-100 text-emerald-800':'bg-rose-100 text-rose-800'} px-3 py-1">Saldo da lista: <strong class="ml-1">${formatCurrency(saldo)}</strong></span>
  `;
}

function listenForTransactions() {
  if (!currentUser) return;
  const userId = currentUser.uid;
  transacoesRef = isEnvironment ? collection(db, 'artifacts', appId, 'users', userId, 'transacoes') : collection(db, `users/${userId}/transacoes`);
  const q = query(transacoesRef);
  try {
    unsubscribeTransactions = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) { allTransactions = []; applyFilters(); return; }
      allTransactions = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
      applyFilters();
      try { updateGlobalTotals(); } catch {}
    }, (error) => {
      showToast(`Erro ao carregar dados: ${error.message}`, 'error');
      transactionsTableBody.innerHTML = `<tr><td colspan="7" class="px-6 py-4 text-center text-red-500">Erro: ${error.message}. Verifique as regras de segurança.</td></tr>`;
    });
  } catch (error) { showToast(`Erro crítico: ${error.message}`, 'error'); }
}

function updateGlobalTotals() {
  const el = document.getElementById('global-totals');
  if (!el) return;
  const arr = Array.isArray(allTransactions) ? allTransactions : [];
  const qtd = arr.length;
  el.innerHTML = `<span class="inline-flex items-center rounded-md bg-white/70 px-3 py-1">Todos: <strong class=\"ml-1\">${qtd}</strong></span>`;
}

function renderTransactions(transacoes) {
  transacoes.sort((a, b) => {
    const dateA = a.dataVencimento.toDate ? a.dataVencimento.toDate() : new Date(a.dataVencimento);
    const dateB = b.dataVencimento.toDate ? b.dataVencimento.toDate() : new Date(b.dataVencimento);
    return dateB - dateA;
  });
  if (transactionsCards) transactionsCards.innerHTML = '';
  if (transacoes.length === 0) { 
    transactionsTableBody.innerHTML = `<tr><td colspan=\"7\" class=\"px-6 py-4 text-center text-gray-500\">Nenhum lançamento encontrado para os filtros atuais.</td></tr>`; 
    if (transactionsCards) transactionsCards.innerHTML = `<p class=\"text-center text-gray-500\">Nenhum lançamento encontrado para os filtros atuais.</p>`;
    return; 
  }
  transactionsTableBody.innerHTML = '';
  transacoes.forEach(tx => {
    const row = document.createElement('tr');
    row.setAttribute('data-id', tx.id);
    const valorClasse = tx.tipo === 'receber' ? 'text-green-600' : 'text-red-600';
    const statusClasse = tx.status === 'pago' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';
    const statusTexto = tx.status === 'pago' ? 'Pago/Recebido' : 'Pendente';
    const acaoBotaoTexto = tx.status === 'pago' ? (tx.tipo === 'receber' ? 'Estornar' : 'Cancelar Pgto') : (tx.tipo === 'receber' ? 'Receber' : 'Pagar');
    const acaoBotaoClasse = tx.status === 'pago' ? 'bg-gray-400 hover:bg-gray-500' : (tx.tipo === 'receber' ? 'bg-green-500 hover:bg-green-600' : 'bg-blue-500 hover:bg-blue-600');
    const categoriaTexto = tx.categoria || 'N/D';
    row.innerHTML = `
      <td class="px-3 py-3 sm:px-6 sm:py-4 whitespace-normal break-words text-sm text-gray-900">${tx.descricao}</td>
      <td class="px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap text-sm ${valorClasse}">${formatCurrency(tx.valor)}</td>
      <td class="hidden sm:table-cell px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap text-sm text-gray-500">${categoriaTexto}</td>
      <td class="hidden sm:table-cell px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap text-sm text-gray-500">${tx.tipo === 'receber' ? 'A Receber' : 'A Pagar'}</td>
      <td class="hidden sm:table-cell px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap text-sm text-gray-500">${formatDate(tx.dataVencimento)}</td>
      <td class="px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap">
        <span class="px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${statusClasse}">${statusTexto}</span>
      </td>
      <td class="px-3 py-3 sm:px-6 sm:py-4 whitespace-nowrap text-sm font-medium">
        <button data-action="toggle-status" data-id="${tx.id}" data-status="${tx.status}" class="w-full sm:w-auto px-3 py-1 rounded-md text-white ${acaoBotaoClasse} transition-all duration-200 hover:scale-105">${acaoBotaoTexto}</button>
        <button data-action="delete" data-id="${tx.id}" class="w-full sm:w-auto mt-2 sm:mt-0 sm:ml-2 px-3 py-1 rounded-md text-white bg-red-500 hover:bg-red-600 transition-all duration-200 hover:scale-105">Excluir</button>
      </td>`;
    transactionsTableBody.appendChild(row);
    // Também renderiza card para mobile
    if (transactionsCards) {
      const card = document.createElement('div');
      card.className = 'tx-card rounded-lg border border-gray-200 bg-white p-3 shadow-sm';
      card.setAttribute('data-id', tx.id);
      const categoriaTexto = tx.categoria || 'N/D';
      const statusTexto = tx.status === 'pago' ? 'Pago/Recebido' : 'Pendente';
      const statusClasse = tx.status === 'pago' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';
      const acaoBotaoTexto = tx.status === 'pago' ? (tx.tipo === 'receber' ? 'Estornar' : 'Cancelar Pgto') : (tx.tipo === 'receber' ? 'Receber' : 'Pagar');
      const acaoBotaoClasse = tx.status === 'pago' ? 'bg-gray-400 hover:bg-gray-500' : (tx.tipo === 'receber' ? 'bg-green-500 hover:bg-green-600' : 'bg-blue-500 hover:bg-blue-600');
      const valorClasse = tx.tipo === 'receber' ? 'text-green-600' : 'text-red-600';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-medium text-gray-900 break-words">${tx.descricao}</p>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5">${categoriaTexto}</span>
              <span>• ${tx.tipo === 'receber' ? 'A Receber' : 'A Pagar'}</span>
              <span>• ${formatDate(tx.dataVencimento)}</span>
            </div>
          </div>
          <div class="text-right">
            <p class="text-sm ${valorClasse} font-semibold">${formatCurrency(tx.valor)}</p>
            <span class="mt-1 inline-flex px-2 py-0.5 text-[11px] leading-5 font-semibold rounded-full ${statusClasse}">${statusTexto}</span>
          </div>
        </div>
        <div class="mt-3 flex flex-col gap-2">
          <button data-action="toggle-status" data-id="${tx.id}" data-status="${tx.status}" class="w-full px-3 py-2 rounded-md text-white ${acaoBotaoClasse} transition-all duration-200">${acaoBotaoTexto}</button>
          <button data-action="delete" data-id="${tx.id}" class="w-full px-3 py-2 rounded-md text-white bg-red-500 hover:bg-red-600 transition-all duration-200">Excluir</button>
        </div>`;
      transactionsCards.appendChild(card);
    }
  });
}

function updateSummary(transacoes) {
  let totalReceber = 0, totalPagar = 0;
  // Totais (pendentes) respeitam os filtros atuais
  transacoes.forEach(tx => {
    if (tx.status === 'pendente') {
      if (tx.tipo === 'receber') totalReceber += (tx.valor || 0);
      else totalPagar += (tx.valor || 0);
    }
  });
  // Saldo global (baseado no pago) ignora filtros e usa TODAS as transações
  const saldo = computeGlobalSaldo();
  totalReceberEl.textContent = formatCurrency(totalReceber);
  totalPagarEl.textContent = formatCurrency(totalPagar);
  saldoAtualEl.textContent = formatCurrency(saldo);
  if (saldo < 0) { saldoAtualEl.classList.remove('text-blue-600','text-green-600'); saldoAtualEl.classList.add('text-red-600'); }
  else if (saldo > 0) { saldoAtualEl.classList.remove('text-blue-600','text-red-600'); saldoAtualEl.classList.add('text-green-600'); }
  else { saldoAtualEl.classList.remove('text-green-600','text-red-600'); saldoAtualEl.classList.add('text-blue-600'); }
}

function computeGlobalSaldo() {
  try {
    const arr = Array.isArray(allTransactions) ? allTransactions : [];
    let s = 0;
    arr.forEach(tx => {
      if (tx && tx.status === 'pago') {
        const val = tx.valor || 0;
        if (tx.tipo === 'receber') s += val; else s -= val;
      }
    });
    return s;
  } catch { return 0; }
}

function updateChart(transacoes) {
  if (!categoryChartCanvas) return;
  const gastosPorCategoria = transacoes.filter(tx => tx.tipo === 'pagar' && tx.status === 'pago').reduce((acc, tx) => { const cat = tx.categoria || 'N/D'; acc[cat] = (acc[cat] || 0) + tx.valor; return acc; }, {});
  const labels = Object.keys(gastosPorCategoria);
  const data = Object.values(gastosPorCategoria);
  if (chartInstance) chartInstance.destroy();
  if (labels.length > 0) {
    // garante visibilidade da área do gráfico
    try { const wrap = categoryChartCanvas.parentElement; if (wrap) { wrap.style.display = 'block'; wrap.style.minHeight = '240px'; } } catch {}
    const ctx = categoryChartCanvas.getContext('2d');
    chartInstance = new Chart(ctx, { type:'doughnut', data:{ labels, datasets:[{ label:'Gastos por Categoria', data, backgroundColor:['#3b82f6','#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#6366f1','#a855f7','#ec4899','#84cc16'], hoverOffset:4 }]}, options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'right' } } } });
  } else {
    // retrai a área do gráfico quando vazio
    try { const wrap = categoryChartCanvas.parentElement; if (wrap) { wrap.style.display = 'none'; } } catch {}
  }
}

function updateMonthlyChart(transacoes) {
  if (!monthlyChartCanvas) return;
  const pagos = transacoes.filter(tx => tx.tipo === 'pagar' && tx.status === 'pago');
  const byMonth = pagos.reduce((acc, tx) => {
    const d = tx.dataVencimento && tx.dataVencimento.toDate ? tx.dataVencimento.toDate() : new Date(tx.dataVencimento);
    if (isNaN(d)) return acc;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    acc[key] = (acc[key] || 0) + (tx.valor || 0);
    return acc;
  }, {});
  const keys = Object.keys(byMonth).sort();
  // Mantém últimos 12 meses se houver mais
  const labels = keys.slice(-12);
  const data = labels.map(k => byMonth[k]);
  if (monthlyChartInstance) monthlyChartInstance.destroy();
  const block = monthlyChartCanvas.parentElement ? monthlyChartCanvas.parentElement.parentElement : null; // bloco com título
  if (labels.length > 0) {
    try { if (block) { block.style.display = 'block'; } } catch {}
    const ctx = monthlyChartCanvas.getContext('2d');
    monthlyChartInstance = new Chart(ctx, {
      type: 'bar',
      data: { labels: labels.map(k => k.replace('-', '/')), datasets: [{ label: 'Gastos (R$)', data, backgroundColor: '#60a5fa' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  } else {
    // retrai bloco mensal quando vazio
    try { if (block) { block.style.display = 'none'; } } catch {}
  }
}

async function handleAddTransaction(e) {
  e.preventDefault(); setLoading(true);
  if (!transacoesRef) { showToast('Erro: A coleção de transações não foi inicializada.', 'error'); setLoading(false); return; }
  const [year, month, day] = formData.value.split('-');
  const dataFormatada = new Date(year, month - 1, day);
  const novaTransacao = { descricao: formDescricao.value, valor: parseFloat(formValor.value.replace(/\./g,'').replace(',', '.')), categoria: formCategoria.value, tipo: formTipo.value, dataVencimento: Timestamp.fromDate(dataFormatada), status: 'pendente', createdAt: serverTimestamp() };
  try { await addDoc(transacoesRef, novaTransacao); showToast('Lançamento adicionado com sucesso!', 'success'); transactionForm.reset(); formValor.value = '0,00'; try { formData.valueAsDate = new Date(); } catch {}
    const ev = new Event('change'); formTipo.dispatchEvent(ev);
  } catch (error) { showToast(`Erro ao salvar: ${error.message}`, 'error'); } finally { setLoading(false); }
}

async function handleListActions(e) {
  const target = e.target.closest('button'); if (!target) return;
  const action = target.dataset.action; const id = target.dataset.id; if (!action) return;
  // Admin user actions
  if (action === 'user-approve' || action === 'user-reject') {
    const uid = target.dataset.uid;
    if (!uid) return;
    try {
      setLoading(true);
      const userRef = isEnvironment ? doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', uid) : doc(db, 'user_profiles', uid);
      if (action === 'user-approve') {
        await updateDoc(userRef, { status: 'approved' });
        showToast('Utilizador aprovado!', 'success');
      } else {
        // Recusar: opcionalmente podemos apagar ou marcar como recusado; aqui vamos marcar como 'rejected'
        await updateDoc(userRef, { status: 'rejected' });
        showToast('Utilizador recusado.', 'success');
      }
    } catch (err) {
      showToast(`Erro ao atualizar utilizador: ${err.message}`, 'error');
    } finally { setLoading(false); }
    return;
  }
  if (action === 'user-make-admin' || action === 'user-revoke' || action === 'user-remove-admin') {
    const uid = target.dataset.uid;
    if (!uid) return;
    try {
      let confirmText, okText;
      if (action === 'user-make-admin') { confirmText = 'Conceder permissões de administrador a este utilizador?'; okText = 'Tornar Admin'; }
      else if (action === 'user-remove-admin') { confirmText = 'Remover permissões de administrador deste utilizador?'; okText = 'Remover Admin'; }
      else { confirmText = 'Remover o acesso deste utilizador?'; okText = 'Remover'; }
      const confirmed = await showConfirmModal('Confirmar ação', confirmText, okText);
      if (!confirmed) return;
      setLoading(true);
      const userRef = isEnvironment ? doc(db, 'artifacts', appId, 'public', 'data', 'user_profiles', uid) : doc(db, 'user_profiles', uid);
      if (action === 'user-make-admin') {
        await updateDoc(userRef, { role: 'admin', status: 'approved' });
        showToast('Utilizador tornou-se admin.', 'success');
      } else if (action === 'user-remove-admin') {
        await updateDoc(userRef, { role: 'user' });
        showToast('Permissões de admin removidas.', 'success');
      } else {
        await updateDoc(userRef, { status: 'revoked' });
        showToast('Acesso removido.', 'success');
      }
    } catch (err) {
      showToast(`Erro ao aplicar ação: ${err.message}`, 'error');
    } finally { setLoading(false); }
    return;
  }
  // Transaction actions
  const idPresent = !!id;
  if (!idPresent) return;
  if (transacoesRef && (action === 'toggle-status' || action === 'delete')) {
    const docRef = doc(transacoesRef, id);
    if (action === 'toggle-status') { const currentStatus = target.dataset.status; const newStatus = currentStatus === 'pendente' ? 'pago' : 'pendente'; setLoading(true); try { await updateDoc(docRef, { status: newStatus }); showToast('Status atualizado!', 'success'); } catch (error) { showToast(`Erro: ${error.message}`, 'error'); } finally { setLoading(false); } }
    if (action === 'delete') { const confirmed = await showConfirmModal('Excluir Lançamento', 'Tem certeza que deseja excluir este lançamento? Esta ação não pode ser desfeita.', 'Excluir'); if (confirmed) { setLoading(true); try { await deleteDoc(docRef); showToast('Lançamento excluído!', 'success'); } catch (error) { showToast(`Erro: ${error.message}`, 'error'); } finally { setLoading(false); } } }
  }
  // Admin actions omitted in this modular split for brevity (would mirror original)
}

async function handleQuitarTudo() {
  if (!transacoesRef) return;
  const pendentes = (latestFilteredTransactions || []).filter(tx => tx.status === 'pendente');
  if (pendentes.length === 0) { showToast('Não há lançamentos pendentes para quitar.', 'error'); return; }
  const confirmed = await showConfirmModal('Quitar Tudo', `Deseja quitar ${pendentes.length} lançamento(s) pendente(s)?`, 'Quitar'); if (!confirmed) return;
  try { setLoading(true); const batch = writeBatch(db); pendentes.forEach(tx => { const ref = doc(transacoesRef, tx.id); batch.update(ref, { status: 'pago' }); }); await batch.commit(); showToast('Todos os lançamentos pendentes foram quitados!', 'success'); } catch (e) { showToast(`Erro ao quitar: ${e.message}`, 'error'); } finally { setLoading(false); }
}

async function handleExcluirTudo() {
  if (!transacoesRef) return;
  const alvo = (latestFilteredTransactions || []); if (alvo.length === 0) { showToast('Não há lançamentos para excluir no filtro atual.', 'error'); return; }
  const confirmed = await showConfirmModal('Excluir Tudo', `Deseja excluir ${alvo.length} lançamento(s) exibido(s) pelo filtro atual? Esta ação não pode ser desfeita.`, 'Excluir'); if (!confirmed) return;
  try { setLoading(true); const batch = writeBatch(db); alvo.forEach(tx => { const ref = doc(transacoesRef, tx.id); batch.delete(ref); }); await batch.commit(); showToast('Todos os lançamentos filtrados foram excluídos!', 'success'); } catch (e) { showToast(`Erro ao excluir: ${e.message}`, 'error'); } finally { setLoading(false); }
}

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', () => {
  loadingOverlay = document.getElementById('loading-overlay');
  loginScreen = document.getElementById('login-screen');
  pendingScreen = document.getElementById('pending-screen');
  appScreen = document.getElementById('app-screen');
  adminScreen = document.getElementById('admin-screen');

  loginBtn = document.getElementById('login-btn');
  logoutBtnPending = document.getElementById('logout-btn-pending');
  logoutBtnMain = document.getElementById('logout-btn-main');
  logoutBtnAdmin = document.getElementById('logout-btn-admin');

  transactionForm = document.getElementById('transaction-form');
  formDescricao = document.getElementById('descricao');
  formValor = document.getElementById('valor');
  formCategoria = document.getElementById('categoria');
  formTipo = document.getElementById('tipo');
  formData = document.getElementById('data');

  transactionsTableBody = document.getElementById('transactions-table-body');
  transactionsCards = document.getElementById('transactions-cards');
  totalReceberEl = document.getElementById('total-receber');
  totalPagarEl = document.getElementById('total-pagar');
  saldoAtualEl = document.getElementById('saldo-atual');

  pendingUsersList = document.getElementById('pending-users-list');
  allUsersList = document.getElementById('all-users-list');

  userNameEl = document.getElementById('user-name');
  userEmailEl = document.getElementById('user-email');
  userPhotoEl = document.getElementById('user-photo');
  adminNameEl = document.getElementById('admin-name');
  adminEmailEl = document.getElementById('admin-email');
  adminPhotoEl = document.getElementById('admin-photo');
  
  loginErrorEl = document.getElementById('login-error');
  toaster = document.getElementById('toaster');

  modalBackdrop = document.getElementById('confirm-modal-backdrop');
  modalTitle = document.getElementById('confirm-modal-title');
  modalText = document.getElementById('confirm-modal-text');
  modalCancel = document.getElementById('confirm-modal-cancel');
  modalOk = document.getElementById('confirm-modal-ok');

  // Edit modal elements
  editModalBackdrop = document.getElementById('edit-modal-backdrop');
  editDescricao = document.getElementById('edit-descricao');
  editValor = document.getElementById('edit-valor');
  editCategoria = document.getElementById('edit-categoria');
  editTipo = document.getElementById('edit-tipo');
  editData = document.getElementById('edit-data');
  editCancelBtn = document.getElementById('edit-cancel');
  editSaveBtn = document.getElementById('edit-save');

  searchInput = document.getElementById('search-input');
  filterStartDate = document.getElementById('filter-start-date');
  filterEndDate = document.getElementById('filter-end-date');
  clearFiltersBtn = document.getElementById('clear-filters-btn');
  categoryChartCanvas = document.getElementById('category-chart');
  monthlyChartCanvas = document.getElementById('monthly-chart');
  
  couponInput = document.getElementById('coupon-input');
  applyCouponBtn = document.getElementById('apply-coupon-btn');
  couponMessage = document.getElementById('coupon-message');
  editModeBtn = document.getElementById('edit-mode-btn');
  editModeBanner = document.getElementById('edit-mode-banner');
  editModeClose = document.getElementById('edit-mode-close');

  ofxFileInput = document.getElementById('ofx-file-input');
  selectOfxBtn = document.getElementById('select-ofx-btn');
  importOfxBtn = document.getElementById('import-ofx-btn');
  ofxFileName = document.getElementById('ofx-file-name');
  ofxPreviewEl = document.getElementById('ofx-preview');
  ofxPreviewBody = document.getElementById('ofx-preview-body');
  ofxPreviewCount = document.getElementById('ofx-preview-count');
  ofxPreviewNote = document.getElementById('ofx-preview-note');
  clearOfxBtn = document.getElementById('clear-ofx-btn');

  try { formData.valueAsDate = new Date(); } catch {}
  initialize();
});

// --- EDIÇÃO DE LANÇAMENTOS ---
function ymd(date) {
  const yyyy = date.getFullYear(); const mm = String(date.getMonth()+1).padStart(2,'0'); const dd = String(date.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

function populateEditCategories() {
  const tipo = editTipo.value; const cats = CATEGORIAS[tipo] || [];
  editCategoria.innerHTML = '';
  cats.forEach(cat => { const opt = document.createElement('option'); opt.value = cat; opt.textContent = cat; editCategoria.appendChild(opt); });
}

function openEditModal(id) {
  const tx = (allTransactions || []).find(t => t.id === id);
  if (!tx) return;
  currentEditId = id;
  editDescricao.value = tx.descricao || '';
  editValor.value = (tx.valor != null) ? (tx.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00';
  editTipo.value = tx.tipo || 'pagar';
  populateEditCategories();
  if (tx.categoria) { editCategoria.value = tx.categoria; }
  let d;
  if (tx.dataVencimento && tx.dataVencimento.toDate) d = tx.dataVencimento.toDate(); else d = new Date(tx.dataVencimento);
  if (!isNaN(d)) editData.value = ymd(d);
  editModalBackdrop.classList.remove('hidden');
}

function closeEditModal() {
  editModalBackdrop.classList.add('hidden');
  currentEditId = null;
}

// Wire up edit modal events (after DOMContentLoaded variables are set)
document.addEventListener('DOMContentLoaded', () => {
  if (editTipo) editTipo.addEventListener('change', populateEditCategories);
  if (editValor) editValor.addEventListener('input', (e) => {
    const target = e.target; const formatted = formatCurrencyInput(target.value); target.value = formatted; target.setSelectionRange(formatted.length, formatted.length);
  });
  if (editCancelBtn) editCancelBtn.addEventListener('click', (e) => { e.preventDefault(); closeEditModal(); });
  if (editModalBackdrop) editModalBackdrop.addEventListener('click', (e) => { if (e.target === editModalBackdrop) closeEditModal(); });
  if (editSaveBtn) editSaveBtn.addEventListener('click', async (e) => {
    e.preventDefault(); if (!currentEditId || !transacoesRef) return;
    try {
      setLoading(true);
      const [yy, mm, dd] = (editData.value || '').split('-');
      const novaData = new Date(yy, (mm||1) - 1, dd || 1);
      const payload = {
        descricao: editDescricao.value.trim(),
        valor: parseFloat(editValor.value.replace(/\./g,'').replace(',', '.')),
        categoria: editCategoria.value,
        tipo: editTipo.value,
        dataVencimento: Timestamp.fromDate(novaData)
      };
      await updateDoc(doc(transacoesRef, currentEditId), payload);
      showToast('Lançamento atualizado!', 'success');
      closeEditModal();
    } catch (error) {
      showToast(`Erro ao atualizar: ${error.message}`, 'error');
    } finally { setLoading(false); }
  });
});
