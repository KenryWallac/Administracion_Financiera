/* ═══════════════════════════════════════════════════════════════
   FINFLOW — SCRIPT PRINCIPAL
   ───────────────────────────────────────────────────────────────
   PERSISTENCIA: localStorage (Primera versión)
   - Simple, sin servidor, funciona offline
   - Límite ~5MB (suficiente para miles de movimientos)
   - Los datos sobreviven al cierre del navegador
   - Para producción real → migrar a IndexedDB o backend + SQLite

   ESTRUCTURA DE DATOS:
   - movimientos[]  → array de objetos de transacciones
   - cuentas[]      → array de referentes bancarios
   - patrones[]     → array de patrones de detección de correo
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   ESTADO GLOBAL DE LA APLICACIÓN
   Todas las variables de estado en un solo objeto
═══════════════════════════════════════════════════════════════ */
const App = {
  // Datos principales
  movimientos: [],
  cuentas: [],
  patrones: [],

  // Estado de UI
  movimientoEditId: null,    // ID del movimiento que se está editando (null = nuevo)
  cuentaEditId:    null,     // ID de la cuenta que se está editando
  tipoActual:      'ingreso', // Tipo seleccionado en el formulario ('ingreso' | 'gasto')

  // Claves para localStorage
  KEYS: {
    movimientos: 'finflow_movimientos',
    cuentas:     'finflow_cuentas',
    patrones:    'finflow_patrones',
  }
};

/* ═══════════════════════════════════════════════════════════════
   CATEGORÍAS PREDEFINIDAS
   Separadas por tipo para mostrarlas en el formulario
═══════════════════════════════════════════════════════════════ */
const CATEGORIAS = {
  ingreso: [
    'Nómina / Salario',
    'Transferencias / Honorarios',
    'Inversiones',
    'Ahorros',
    'Ahorro compartido',
    'Otros ingresos'
  ],
  gasto: [
    'Alimentación',
    'Gasolina / combustible',
    'Hogar / Servicios',
    'Otras compras',
    'Pago de tarjeta',
    'Diezmo / Donaciones',
    'Recargas',
    'Retiro de paquetes',
    'Deudas pagadas',
    'Suscripciones',
    'Aporte a familia',
    'Otros gastos'
  ],
  // Las transferencias entre cuentas propias NO son ingreso ni gasto.
  // Se registran como par (salida + entrada) pero se EXCLUYEN del cálculo
  // de totales para no inflar los números.
  transferencia: [
    'Transferencia entre cuentas'
  ]
};

/* Iconos por tipo de cuenta */
const CUENTA_ICONOS = {
  banco:    '🏦',
  tarjeta:  '💳',
  ahorro:   '🏧',
  efectivo: '💵',
  otro:     '🗂️'
};

/* ═══════════════════════════════════════════════════════════════
   PERSISTENCIA — LECTURA / ESCRITURA EN localStorage
═══════════════════════════════════════════════════════════════ */

/** Guarda un array de datos en localStorage con la clave dada */
function guardarEnStorage(clave, datos) {
  try {
    localStorage.setItem(clave, JSON.stringify(datos));
  } catch (e) {
    console.error('Error al guardar en localStorage:', e);
    showToast('Error al guardar datos. Almacenamiento lleno.', 'error');
  }
}

/** Lee y parsea un array de datos desde localStorage */
function leerDeStorage(clave) {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Error al leer localStorage:', e);
    return [];
  }
}

/** Carga todos los datos al iniciar la app */
function cargarDatos() {
  App.movimientos = leerDeStorage(App.KEYS.movimientos);
  App.cuentas     = leerDeStorage(App.KEYS.cuentas);
  App.patrones    = leerDeStorage(App.KEYS.patrones);

  // Si no hay patrones, cargar ejemplos predeterminados
  if (App.patrones.length === 0) {
    App.patrones = PATRONES_DEFECTO;
    guardarEnStorage(App.KEYS.patrones, App.patrones);
  }
}

/** Guarda movimientos en storage */
function persistirMovimientos() {
  guardarEnStorage(App.KEYS.movimientos, App.movimientos);
}

/** Guarda cuentas en storage */
function persistirCuentas() {
  guardarEnStorage(App.KEYS.cuentas, App.cuentas);
}

/** Guarda patrones en storage */
function persistirPatrones() {
  guardarEnStorage(App.KEYS.patrones, App.patrones);
}

/* ═══════════════════════════════════════════════════════════════
   PATRONES DE DETECCIÓN DE CORREO POR DEFECTO
   El usuario puede agregar / modificar más desde la UI
═══════════════════════════════════════════════════════════════ */
const PATRONES_DEFECTO = [
  {
    id: 'p1',
    nombre: 'Cargo / Débito bancario',
    tipo: 'gasto',
    categoria: 'Otros gastos',
    keywords: ['cargo', 'débito', 'débito en su cuenta', 'se realizó un pago', 'compra realizada', 'retiro'],
    regex: null
  },
  {
    id: 'p2',
    nombre: 'Depósito / Abono',
    tipo: 'ingreso',
    categoria: 'Otros ingresos',
    keywords: ['depósito', 'abono', 'transferencia recibida', 'ingreso a su cuenta', 'crédito en cuenta'],
    regex: null
  },
  {
    id: 'p3',
    nombre: 'Nómina recibida',
    tipo: 'ingreso',
    categoria: 'Nómina / Salario',
    keywords: ['nómina', 'salario', 'pago de nómina', 'dispersión de nómina'],
    regex: null
  }
];

/* ═══════════════════════════════════════════════════════════════
   GENERADOR DE IDs ÚNICOS
═══════════════════════════════════════════════════════════════ */
function generarId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

/* ═══════════════════════════════════════════════════════════════
   FORMATEO DE MONEDA Y FECHAS
═══════════════════════════════════════════════════════════════ */

/** Formatea número como moneda ($ 1,234.56) */
function formatMoney(num) {
  return new Intl.NumberFormat('es-DO', {
    style: 'currency',
    currency: 'DOP',
    minimumFractionDigits: 2
  }).format(num || 0);
}

/** Formatea fecha ISO (YYYY-MM-DD) a formato legible */
function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

/** Obtiene la fecha de hoy en formato YYYY-MM-DD */
function hoy() {
  return new Date().toISOString().split('T')[0];
}

/* ═══════════════════════════════════════════════════════════════
   NAVEGACIÓN — MOSTRAR/OCULTAR SECCIONES
═══════════════════════════════════════════════════════════════ */

/**
 * Muestra la sección indicada y actualiza el estado de los botones del nav
 * @param {string} nombre - ID de la sección (sin el prefijo "section-")
 */
function showSection(nombre) {
  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  // Mostrar la sección seleccionada
  const target = document.getElementById('section-' + nombre);
  if (target) target.classList.add('active');

  // Actualizar botones de nav activos
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.section === nombre);
  });

  // Actualizar título del header
  const titulos = {
    dashboard:    'Panel',
    movimientos:  'Movimientos',
    cuentas:      'Cuentas',
    correos:      'Correos',
    reportes:     'Reportes'
  };
  document.getElementById('pageTitle').textContent = titulos[nombre] || nombre;

  // Si es reportes, actualizar tablas de resumen
  if (nombre === 'reportes') renderReportesResumen();

  // Cerrar sidebar en móvil
  closeSidebar();
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR MÓVIL
═══════════════════════════════════════════════════════════════ */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('visible');
}

/* ═══════════════════════════════════════════════════════════════
   MODALES — ABRIR / CERRAR
═══════════════════════════════════════════════════════════════ */

/** Abre un modal por su ID */
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

/** Cierra un modal por su ID */
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

/** Cierra modal si el clic fue directamente sobre el overlay (fuera del cuadro) */
function closeModalOutside(event, id) {
  if (event.target.id === id) closeModal(id);
}

/* ═══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════════════════════════════════ */

/**
 * Muestra un mensaje toast temporal
 * @param {string} mensaje - Texto del mensaje
 * @param {'success'|'error'|'info'} tipo - Estilo visual
 * @param {number} duracion - Milisegundos antes de desaparecer
 */
function showToast(mensaje, tipo = 'info', duracion = 3000) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;

  const iconos = { success: '✓', error: '✕', info: 'ℹ' };
  toast.innerHTML = `<span>${iconos[tipo]}</span><span>${mensaje}</span>`;

  container.appendChild(toast);

  // Auto-eliminar después de la duración
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duracion);
}

/* ═══════════════════════════════════════════════════════════════
   MOVIMIENTOS — LÓGICA PRINCIPAL
═══════════════════════════════════════════════════════════════ */

/**
 * Configura el tipo de movimiento en el formulario (ingreso/gasto/transferencia)
 * Actualiza los botones toggle y recarga las categorías.
 * Las transferencias muestran además el campo de cuenta destino.
 */
function setTipo(tipo) {
  App.tipoActual = tipo;

  // Actualizar estado visual de los tres botones
  document.getElementById('btnIngreso').classList.toggle('active', tipo === 'ingreso');
  document.getElementById('btnGasto').classList.toggle('active', tipo === 'gasto');
  document.getElementById('btnTransferencia').classList.toggle('active', tipo === 'transferencia');

  // Mostrar / ocultar campo de cuenta destino (solo en transferencia)
  const rowDestino = document.getElementById('rowCuentaDestino');
  if (rowDestino) rowDestino.style.display = tipo === 'transferencia' ? 'flex' : 'none';

  // Cargar categorías según tipo
  if (tipo === 'transferencia') {
    const sel = document.getElementById('movCategoria');
    if (sel) sel.innerHTML = '<option value="Transferencia entre cuentas">Transferencia entre cuentas</option>';
  } else {
    cargarCategoriasEnSelect('movCategoria', tipo);
  }
}

/** Carga las categorías disponibles en un elemento <select> */
function cargarCategoriasEnSelect(selectId, tipo) {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  const cats = tipo === 'ingreso' ? CATEGORIAS.ingreso : CATEGORIAS.gasto;
  const allCats = [...CATEGORIAS.ingreso, ...CATEGORIAS.gasto];

  // Si el selectId no tiene tipo (para patrones), mostrar todas
  const lista = tipo ? cats : allCats;

  sel.innerHTML = lista.map(c => `<option value="${c}">${c}</option>`).join('');
}

/** Carga las cuentas disponibles en todos los selects de cuenta */
function cargarCuentasEnSelects() {
  const opciones = App.cuentas.length
    ? App.cuentas.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')
    : '';

  // Select en formulario de movimiento
  const movCuenta = document.getElementById('movCuenta');
  if (movCuenta) {
    movCuenta.innerHTML = `<option value="">Sin especificar</option>${opciones}`;
  }

  // Selects de filtros
  ['filtroCuenta', 'filtroCuenta2', 'emailCuentaAsoc'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const defaultLabel = id === 'emailCuentaAsoc' ? 'Seleccionar cuenta asociada' : 'Todas';
      el.innerHTML = `<option value="">${defaultLabel}</option>${opciones}`;
    }
  });
}

/**
 * Prepara el formulario para agregar un nuevo movimiento
 */
function prepararNuevoMovimiento() {
  App.movimientoEditId = null;
  document.getElementById('modalMovTitle').textContent = 'Nuevo Movimiento';
  document.getElementById('movId').value = '';
  document.getElementById('movMonto').value = '';
  document.getElementById('movFecha').value = hoy();
  document.getElementById('movDescripcion').value = '';
  setTipo('ingreso'); // Resetear a ingreso por defecto
  cargarCuentasEnSelects();
  openModal('modalMovimiento');
}

/**
 * Prepara el formulario para editar un movimiento existente
 * @param {string} id - ID del movimiento
 */
function editarMovimiento(id) {
  const mov = App.movimientos.find(m => m.id === id);
  if (!mov) return;

  App.movimientoEditId = id;
  document.getElementById('modalMovTitle').textContent = 'Editar Movimiento';
  document.getElementById('movId').value = id;
  document.getElementById('movMonto').value = mov.monto;
  document.getElementById('movFecha').value = mov.fecha;
  document.getElementById('movDescripcion').value = mov.descripcion;

  setTipo(mov.tipo);
  cargarCategoriasEnSelect('movCategoria', mov.tipo);
  cargarCuentasEnSelects();

  // Seleccionar valores guardados
  document.getElementById('movCategoria').value = mov.categoria || '';
  document.getElementById('movCuenta').value    = mov.cuentaId || '';

  openModal('modalMovimiento');
}

/**
 * Valida y guarda un movimiento (nuevo o editado).
 * Si el tipo es 'transferencia', crea DOS movimientos vinculados:
 *   - Salida de la cuenta origen
 *   - Entrada en la cuenta destino
 * Ambos quedan excluidos del cálculo de ingresos/gastos totales.
 */
function guardarMovimiento() {
  // ─── Obtener valores del formulario ───
  const monto       = parseFloat(document.getElementById('movMonto').value);
  const fecha       = document.getElementById('movFecha').value;
  const descripcion = document.getElementById('movDescripcion').value.trim();
  const categoria   = document.getElementById('movCategoria').value;
  const cuentaId    = document.getElementById('movCuenta').value;
  const tipo        = App.tipoActual;

  // ─── Validaciones básicas ───
  if (!fecha) {
    showToast('Por favor, selecciona una fecha.', 'error'); return;
  }
  if (!descripcion) {
    showToast('Por favor, escribe una descripción.', 'error'); return;
  }
  if (isNaN(monto) || monto <= 0) {
    showToast('El monto debe ser un número positivo.', 'error'); return;
  }

  // ─── Validación extra para transferencias ───
  if (tipo === 'transferencia') {
    const cuentaDestinoId = document.getElementById('movCuentaDestino')?.value || '';
    if (!cuentaId) {
      showToast('Selecciona la cuenta origen de la transferencia.', 'error'); return;
    }
    if (!cuentaDestinoId) {
      showToast('Selecciona la cuenta destino de la transferencia.', 'error'); return;
    }
    if (cuentaId === cuentaDestinoId) {
      showToast('La cuenta origen y destino no pueden ser la misma.', 'error'); return;
    }

    // Generar un ID de vinculación para unir los dos movimientos
    const vinculoId = generarId();

    const salida = {
      id:          generarId(),
      tipo:        'transferencia',
      subTipo:     'salida',           // identifica la "pata" de salida
      vinculoId,                       // enlaza ambos registros
      monto, fecha, descripcion,
      categoria:   'Transferencia entre cuentas',
      cuentaId,                        // cuenta origen
      creadoEn:    new Date().toISOString()
    };

    const entrada = {
      id:          generarId(),
      tipo:        'transferencia',
      subTipo:     'entrada',          // identifica la "pata" de entrada
      vinculoId,
      monto, fecha, descripcion,
      categoria:   'Transferencia entre cuentas',
      cuentaId:    cuentaDestinoId,    // cuenta destino
      creadoEn:    new Date().toISOString()
    };

    App.movimientos.unshift(entrada);
    App.movimientos.unshift(salida);
    persistirMovimientos();
    closeModal('modalMovimiento');
    renderTodo();
    showToast('Transferencia registrada en ambas cuentas', 'success');
    return;
  }

  if (App.movimientoEditId) {
    // ─── EDITAR movimiento existente ───
    const idx = App.movimientos.findIndex(m => m.id === App.movimientoEditId);
    if (idx !== -1) {
      App.movimientos[idx] = {
        ...App.movimientos[idx],
        tipo, monto, fecha, descripcion, categoria, cuentaId,
        actualizadoEn: new Date().toISOString()
      };
    }
    showToast('Movimiento actualizado correctamente', 'success');
  } else {
    // ─── CREAR nuevo movimiento ───
    const nuevo = {
      id:          generarId(),
      tipo,
      monto,
      fecha,
      descripcion,
      categoria,
      cuentaId,
      creadoEn:    new Date().toISOString()
    };
    App.movimientos.unshift(nuevo); // Agregar al inicio para mostrarlo primero
    showToast('Movimiento registrado', 'success');
  }

  // Persistir y actualizar la UI
  persistirMovimientos();
  closeModal('modalMovimiento');
  renderTodo();
}

/**
 * Solicita confirmación y elimina un movimiento
 * @param {string} id - ID del movimiento
 */
function confirmarEliminarMovimiento(id) {
  const mov = App.movimientos.find(m => m.id === id);
  if (!mov) return;

  document.getElementById('confirmMessage').textContent =
    `¿Eliminar el movimiento "${mov.descripcion}" por ${formatMoney(mov.monto)}?`;

  const btn = document.getElementById('confirmBtn');
  btn.onclick = () => {
    App.movimientos = App.movimientos.filter(m => m.id !== id);
    persistirMovimientos();
    closeModal('modalConfirm');
    renderTodo();
    showToast('Movimiento eliminado', 'info');
  };

  openModal('modalConfirm');
}

/* ═══════════════════════════════════════════════════════════════
   CUENTAS — LÓGICA DE REFERENTES BANCARIOS
═══════════════════════════════════════════════════════════════ */

/** Prepara el formulario para una nueva cuenta */
function prepararNuevaCuenta() {
  App.cuentaEditId = null;
  document.getElementById('modalCuentaTitle').textContent = 'Nueva Cuenta Referente';
  document.getElementById('cuentaId').value    = '';
  document.getElementById('cuentaNombre').value = '';
  document.getElementById('cuentaTipo').value   = 'banco';
  document.getElementById('cuentaColor').value  = '#7fb069';
  document.getElementById('cuentaNotas').value  = '';
  openModal('modalCuenta');
}

/** Prepara el formulario para editar una cuenta existente */
function editarCuenta(id) {
  const cuenta = App.cuentas.find(c => c.id === id);
  if (!cuenta) return;

  App.cuentaEditId = id;
  document.getElementById('modalCuentaTitle').textContent = 'Editar Cuenta';
  document.getElementById('cuentaId').value    = id;
  document.getElementById('cuentaNombre').value = cuenta.nombre;
  document.getElementById('cuentaTipo').value   = cuenta.tipo;
  document.getElementById('cuentaColor').value  = cuenta.color;
  document.getElementById('cuentaNotas').value  = cuenta.notas || '';
  openModal('modalCuenta');
}

/** Valida y guarda una cuenta (nueva o editada) */
function guardarCuenta() {
  const nombre = document.getElementById('cuentaNombre').value.trim();
  const tipo   = document.getElementById('cuentaTipo').value;
  const color  = document.getElementById('cuentaColor').value;
  const notas  = document.getElementById('cuentaNotas').value.trim();

  if (!nombre) {
    showToast('El nombre del referente es obligatorio.', 'error'); return;
  }

  if (App.cuentaEditId) {
    const idx = App.cuentas.findIndex(c => c.id === App.cuentaEditId);
    if (idx !== -1) {
      App.cuentas[idx] = { ...App.cuentas[idx], nombre, tipo, color, notas };
    }
    showToast('Cuenta actualizada', 'success');
  } else {
    App.cuentas.push({ id: generarId(), nombre, tipo, color, notas });
    showToast('Cuenta creada', 'success');
  }

  persistirCuentas();
  closeModal('modalCuenta');
  renderCuentas();
  cargarCuentasEnSelects();
}

/** Confirma y elimina una cuenta */
function confirmarEliminarCuenta(id) {
  const cuenta = App.cuentas.find(c => c.id === id);
  if (!cuenta) return;

  // Verificar si hay movimientos asociados
  const asociados = App.movimientos.filter(m => m.cuentaId === id).length;
  let msg = `¿Eliminar el referente "${cuenta.nombre}"?`;
  if (asociados > 0) {
    msg += ` (${asociados} movimiento${asociados > 1 ? 's' : ''} quedarán sin cuenta asignada)`;
  }

  document.getElementById('confirmMessage').textContent = msg;
  document.getElementById('confirmBtn').onclick = () => {
    App.cuentas = App.cuentas.filter(c => c.id !== id);
    persistirCuentas();
    closeModal('modalConfirm');
    renderCuentas();
    cargarCuentasEnSelects();
    showToast('Cuenta eliminada', 'info');
  };
  openModal('modalConfirm');
}

/* ═══════════════════════════════════════════════════════════════
   FILTROS DE MOVIMIENTOS
═══════════════════════════════════════════════════════════════ */

/**
 * Aplica todos los filtros activos y devuelve los movimientos filtrados
 * Los filtros del dashboard y de la sección movimientos están sincronizados
 */
function obtenerMovimientosFiltrados() {
  const desde   = document.getElementById('filtroDesde')?.value || '';
  const hasta   = document.getElementById('filtroHasta')?.value || '';
  const tipo    = document.getElementById('filtroTipo')?.value  || '';
  const cuentaId = document.getElementById('filtroCuenta')?.value || '';

  return App.movimientos.filter(m => {
    if (desde && m.fecha < desde) return false;
    if (hasta && m.fecha > hasta) return false;
    if (tipo && m.tipo !== tipo) return false;
    if (cuentaId && m.cuentaId !== cuentaId) return false;
    return true;
  });
}

/** Aplica filtros y re-renderiza tablas */
function aplicarFiltros() {
  renderMovimientos();
}

/** Sincroniza el valor de un filtro secundario con el principal */
function sincronizarFiltros(origen, destinoId) {
  const dest = document.getElementById(destinoId);
  if (dest) dest.value = origen.value;
  aplicarFiltros();
}

/** Limpia todos los filtros */
function limpiarFiltros() {
  ['filtroDesde','filtroHasta','filtroTipo','filtroCuenta',
   'filtroDesde2','filtroHasta2','filtroTipo2','filtroCuenta2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  aplicarFiltros();
}

/* ═══════════════════════════════════════════════════════════════
   RENDERIZADO — FUNCIONES QUE ACTUALIZAN EL DOM
═══════════════════════════════════════════════════════════════ */

/** Nombre de la cuenta por ID (helper) */
function getNombreCuenta(cuentaId) {
  if (!cuentaId) return '—';
  const cuenta = App.cuentas.find(c => c.id === cuentaId);
  return cuenta ? cuenta.nombre : '—';
}

/** Color de la cuenta por ID (helper) */
function getColorCuenta(cuentaId) {
  const cuenta = App.cuentas.find(c => c.id === cuentaId);
  return cuenta?.color || '#5a5849';
}

/**
 * Genera el HTML de una fila de la tabla de movimientos
 * @param {Object} mov - Objeto del movimiento
 */
function renderFilaMovimiento(mov) {
  const esIngreso      = mov.tipo === 'ingreso';
  const esTransferencia = mov.tipo === 'transferencia';
  const nombreCuenta   = getNombreCuenta(mov.cuentaId);
  const colorCuenta    = getColorCuenta(mov.cuentaId);

  // Definir badge y color de monto según tipo
  let badgeHtml, montoHtml;

  if (esTransferencia) {
    const esSalida = mov.subTipo === 'salida';
    badgeHtml = `<span class="type-badge badge-transferencia">⇄ ${esSalida ? 'Salida' : 'Entrada'}</span>`;
    montoHtml = `<span class="${esSalida ? 'amount-gasto' : 'amount-ingreso'}">
      ${esSalida ? '→' : '←'} ${formatMoney(mov.monto)}
    </span>`;
  } else if (esIngreso) {
    badgeHtml = `<span class="type-badge badge-ingreso">↑ Ingreso</span>`;
    montoHtml = `<span class="amount-ingreso">+ ${formatMoney(mov.monto)}</span>`;
  } else {
    badgeHtml = `<span class="type-badge badge-gasto">↓ Gasto</span>`;
    montoHtml = `<span class="amount-gasto">− ${formatMoney(mov.monto)}</span>`;
  }

  return `
    <tr ${esTransferencia ? 'class="row-transferencia"' : ''}>
      <td>${formatDate(mov.fecha)}</td>
      <td>
        ${escapeHtml(mov.descripcion)}
        ${esTransferencia && mov.vinculoId ? '<span class="transfer-link-icon" title="Transferencia vinculada">🔗</span>' : ''}
      </td>
      <td>${escapeHtml(mov.categoria || '—')}</td>
      <td>
        ${nombreCuenta !== '—'
          ? `<span class="cuenta-chip" style="border-left:3px solid ${colorCuenta}">${escapeHtml(nombreCuenta)}</span>`
          : '<span class="text-muted">—</span>'
        }
      </td>
      <td>${badgeHtml}</td>
      <td class="text-right">${montoHtml}</td>
      <td class="text-center">
        <div class="action-btns">
          <button class="action-btn" onclick="editarMovimiento('${mov.id}')" title="Editar">✎</button>
          <button class="action-btn danger" onclick="confirmarEliminarMovimiento('${mov.id}')" title="Eliminar">✕</button>
        </div>
      </td>
    </tr>
  `;
}

/** Renderiza las tablas de movimientos con los filtros aplicados */
function renderMovimientos() {
  const filtrados = obtenerMovimientosFiltrados();

  // Tabla del dashboard
  const tbody1   = document.getElementById('tbodyMovimientos');
  const empty1   = document.getElementById('emptyMovimientos');
  // Tabla de sección movimientos
  const tbody2   = document.getElementById('tbodyMovimientos2');
  const empty2   = document.getElementById('emptyMovimientos2');

  const html = filtrados.map(renderFilaMovimiento).join('');

  if (tbody1) tbody1.innerHTML = html;
  if (tbody2) tbody2.innerHTML = html;

  const vacio = filtrados.length === 0;
  if (empty1) empty1.style.display = vacio ? 'block' : 'none';
  if (empty2) empty2.style.display = vacio ? 'block' : 'none';
}

/** Renderiza las tarjetas de cuentas */
function renderCuentas() {
  const grid  = document.getElementById('cuentasGrid');
  const empty = document.getElementById('emptyCuentas');

  if (!grid) return;

  if (App.cuentas.length === 0) {
    grid.innerHTML  = '';
    if (empty) empty.style.display = 'block';
    return;
  }

  if (empty) empty.style.display = 'none';

  grid.innerHTML = App.cuentas.map(c => `
    <div class="cuenta-card">
      <div class="cuenta-color-bar" style="background:${c.color}"></div>
      <div class="cuenta-icon" style="background:${c.color}22">
        ${CUENTA_ICONOS[c.tipo] || '🗂️'}
      </div>
      <div class="cuenta-info">
        <div class="cuenta-name">${escapeHtml(c.nombre)}</div>
        <div class="cuenta-type">${c.tipo.charAt(0).toUpperCase() + c.tipo.slice(1)}</div>
        ${c.notas ? `<div class="cuenta-notes">${escapeHtml(c.notas)}</div>` : ''}
      </div>
      <div class="cuenta-actions">
        <button class="action-btn" onclick="editarCuenta('${c.id}')" title="Editar">✎</button>
        <button class="action-btn danger" onclick="confirmarEliminarCuenta('${c.id}')" title="Eliminar">✕</button>
      </div>
    </div>
  `).join('');
}

/** Calcula y renderiza los totales en las tarjetas del dashboard */
function renderResumen() {
  const filtrados = obtenerMovimientosFiltrados();

  let totalIngresos = 0;
  let totalGastos   = 0;
  let cntIngresos   = 0;
  let cntGastos     = 0;

  filtrados.forEach(m => {
    // Las transferencias se EXCLUYEN del cálculo de totales.
    // Solo se cuentan ingresos y gastos reales.
    if (m.tipo === 'transferencia') return;

    if (m.tipo === 'ingreso') {
      totalIngresos += m.monto;
      cntIngresos++;
    } else {
      totalGastos += m.monto;
      cntGastos++;
    }
  });

  const balance = totalIngresos - totalGastos;

  // Actualizar DOM
  document.getElementById('totalBalance').textContent  = formatMoney(balance);
  document.getElementById('totalIngresos').textContent = formatMoney(totalIngresos);
  document.getElementById('totalGastos').textContent   = formatMoney(totalGastos);

  document.getElementById('balanceSub').textContent   = `${filtrados.length} movimiento${filtrados.length !== 1 ? 's' : ''}`;
  document.getElementById('ingresosSub').textContent  = `${cntIngresos} entrada${cntIngresos !== 1 ? 's' : ''}`;
  document.getElementById('gastosSub').textContent    = `${cntGastos} salida${cntGastos !== 1 ? 's' : ''}`;
}

/** Renderiza los patrones de detección de correo */
function renderPatrones() {
  const grid = document.getElementById('patternsGrid');
  if (!grid) return;

  if (App.patrones.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">No hay patrones configurados.</p>';
    return;
  }

  grid.innerHTML = App.patrones.map(p => `
    <div class="patron-card">
      <div class="patron-info">
        <div class="patron-name">
          <span class="type-badge ${p.tipo === 'ingreso' ? 'badge-ingreso' : 'badge-gasto'}" style="margin-right:6px">
            ${p.tipo}
          </span>
          ${escapeHtml(p.nombre)}
        </div>
        <div class="patron-keywords">
          🔍 ${p.keywords.slice(0,3).join(', ')}${p.keywords.length > 3 ? '...' : ''}
        </div>
      </div>
      <button class="action-btn danger" onclick="eliminarPatron('${p.id}')" title="Eliminar">✕</button>
    </div>
  `).join('');
}

/** Renderiza las tablas de resumen en la sección de reportes */
function renderReportesResumen() {
  // ─── Resumen por cuenta ───
  const tbodyCuentas = document.getElementById('tbodyCuentasResumen');
  if (tbodyCuentas) {
    const mapCuentas = {};

    App.movimientos.forEach(m => {
      const key = m.cuentaId || '__sin_cuenta__';
      if (!mapCuentas[key]) mapCuentas[key] = { ingresos: 0, gastos: 0 };
      if (m.tipo === 'ingreso') mapCuentas[key].ingresos += m.monto;
      else mapCuentas[key].gastos += m.monto;
    });

    tbodyCuentas.innerHTML = Object.entries(mapCuentas).map(([id, data]) => {
      const nombre  = id === '__sin_cuenta__' ? 'Sin cuenta' : getNombreCuenta(id);
      const balance = data.ingresos - data.gastos;
      return `
        <tr>
          <td>${escapeHtml(nombre)}</td>
          <td class="text-right amount-ingreso">${formatMoney(data.ingresos)}</td>
          <td class="text-right amount-gasto">${formatMoney(data.gastos)}</td>
          <td class="text-right ${balance >= 0 ? 'amount-ingreso' : 'amount-gasto'}">${formatMoney(balance)}</td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">Sin datos</td></tr>';
  }

  // ─── Resumen por categoría ───
  const tbodyCat = document.getElementById('tbodyCatResumen');
  if (tbodyCat) {
    const mapCat = {};

    App.movimientos.forEach(m => {
      const key = `${m.tipo}__${m.categoria || 'Sin categoría'}`;
      if (!mapCat[key]) mapCat[key] = { tipo: m.tipo, cat: m.categoria || 'Sin categoría', total: 0, count: 0 };
      mapCat[key].total += m.monto;
      mapCat[key].count++;
    });

    tbodyCat.innerHTML = Object.values(mapCat)
      .sort((a, b) => b.total - a.total)
      .map(d => `
        <tr>
          <td>${escapeHtml(d.cat)}</td>
          <td><span class="type-badge ${d.tipo === 'ingreso' ? 'badge-ingreso' : 'badge-gasto'}">${d.tipo}</span></td>
          <td class="text-right ${d.tipo === 'ingreso' ? 'amount-ingreso' : 'amount-gasto'}">${formatMoney(d.total)}</td>
          <td class="text-right">${d.count}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">Sin datos</td></tr>';
  }
}

/** Función maestra: renderiza todo el contenido de la UI */
function renderTodo() {
  renderResumen();
  renderMovimientos();
  renderCuentas();
  renderPatrones();
  cargarCuentasEnSelects();
}

/* ═══════════════════════════════════════════════════════════════
   CORREOS — DETECCIÓN Y PARSING DE NOTIFICACIONES
═══════════════════════════════════════════════════════════════ */

/**
 * Analiza el texto de un correo y detecta patrones de movimiento
 * Retorna array de movimientos detectados (aún no guardados)
 */
function analizarTextoCorreo(texto, cuentaId) {
  const textoLower = texto.toLowerCase();
  const detectados = [];

  // Regex por defecto para detectar montos con formato $X,XXX.XX o X,XXX.XX
  const montoRegex = /\$?\s?([\d,]+\.?\d{0,2})/g;

  for (const patron of App.patrones) {
    // Verificar si alguna keyword del patrón está en el texto
    const coincide = patron.keywords.some(kw => textoLower.includes(kw.toLowerCase()));
    if (!coincide) continue;

    // Extraer monto usando regex del patrón o el regex por defecto
    const regexStr = patron.regex || '\\$?\\s?([\\d,]+\\.?\\d{0,2})';
    let montoEncontrado = null;

    try {
      const rx = new RegExp(regexStr, 'g');
      const matches = [...texto.matchAll(rx)];
      if (matches.length > 0) {
        // Tomar el primer monto que encontremos
        const raw = matches[0][1].replace(/,/g, '');
        montoEncontrado = parseFloat(raw);
      }
    } catch (e) {
      // Si el regex es inválido, usar el default
      const matches = [...texto.matchAll(montoRegex)];
      if (matches.length > 0) {
        montoEncontrado = parseFloat(matches[0][1].replace(/,/g, ''));
      }
    }

    if (montoEncontrado && montoEncontrado > 0) {
      detectados.push({
        tipo:       patron.tipo,
        monto:      montoEncontrado,
        descripcion: `Detectado: ${patron.nombre}`,
        categoria:   patron.categoria,
        cuentaId:    cuentaId || '',
        fecha:       hoy(),
        patronNombre: patron.nombre
      });
      break; // Un correo = un movimiento (el primer patrón que coincida)
    }
  }

  return detectados;
}

/** Procesa el texto del área de texto de correo */
function procesarCorreo() {
  const texto    = document.getElementById('emailText').value.trim();
  const cuentaId = document.getElementById('emailCuentaAsoc').value;

  if (!texto) {
    showToast('Por favor, pega el texto del correo primero.', 'error'); return;
  }

  const detectados = analizarTextoCorreo(texto, cuentaId);
  mostrarResultadosCorreo(detectados);
}

/** Importa y procesa un archivo JSON de correos */
function importarJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const correos = JSON.parse(e.target.result);
      if (!Array.isArray(correos)) throw new Error('El JSON debe ser un array');

      const todoDetectado = [];
      correos.forEach(correo => {
        const texto = `${correo.asunto || ''} ${correo.cuerpo || ''}`;
        const detectados = analizarTextoCorreo(texto, '');
        detectados.forEach(d => {
          if (correo.fecha) d.fecha = correo.fecha.split('T')[0];
          d.descripcion = correo.asunto ? `Correo: ${correo.asunto}` : d.descripcion;
        });
        todoDetectado.push(...detectados);
      });

      mostrarResultadosCorreo(todoDetectado);
      showToast(`${correos.length} correos analizados, ${todoDetectado.length} movimientos detectados`, 'info');
    } catch (err) {
      showToast('Error al leer el JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/**
 * Muestra en la UI los movimientos detectados del correo
 * Permite al usuario confirmar o descartar cada uno
 */
function mostrarResultadosCorreo(detectados) {
  const contenedor = document.getElementById('emailResultados');
  const lista      = document.getElementById('emailResultadosLista');

  if (!detectados.length) {
    lista.innerHTML = `
      <div class="info-box">
        <div class="info-icon">⚠</div>
        <div class="info-content">
          No se detectaron movimientos. Prueba ajustando los patrones de detección o el texto del correo.
        </div>
      </div>
    `;
    contenedor.style.display = 'block';
    return;
  }

  lista.innerHTML = detectados.map((d, i) => `
    <div class="email-result-item" id="emailResult_${i}">
      <span class="type-badge ${d.tipo === 'ingreso' ? 'badge-ingreso' : 'badge-gasto'}">
        ${d.tipo === 'ingreso' ? '↑' : '↓'} ${d.tipo}
      </span>
      <div class="result-info">
        <div>${escapeHtml(d.descripcion)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted)">
          ${d.patronNombre} — ${formatDate(d.fecha)}
          ${d.cuentaId ? ' — ' + escapeHtml(getNombreCuenta(d.cuentaId)) : ''}
        </div>
      </div>
      <span class="result-amount ${d.tipo === 'ingreso' ? 'amount-ingreso' : 'amount-gasto'}">
        ${formatMoney(d.monto)}
      </span>
      <button class="btn btn-primary btn-sm" onclick="importarMovimientoDetectado(${i})">
        Importar
      </button>
    </div>
  `).join('');

  // Guardar temporalmente los detectados para importación
  window._emailDetectados = detectados;
  contenedor.style.display = 'block';
}

/**
 * Importa un movimiento detectado del correo al registro principal
 * @param {number} idx - Índice en el array temporal de detectados
 */
function importarMovimientoDetectado(idx) {
  const d = window._emailDetectados?.[idx];
  if (!d) return;

  const nuevo = {
    id:          generarId(),
    tipo:        d.tipo,
    monto:       d.monto,
    fecha:       d.fecha,
    descripcion: d.descripcion,
    categoria:   d.categoria,
    cuentaId:    d.cuentaId,
    creadoEn:    new Date().toISOString()
  };

  App.movimientos.unshift(nuevo);
  persistirMovimientos();
  renderTodo();

  // Marcar como importado en la UI
  const el = document.getElementById(`emailResult_${idx}`);
  if (el) {
    el.style.opacity = '0.4';
    el.querySelector('button').textContent = '✓ Importado';
    el.querySelector('button').disabled = true;
  }

  showToast('Movimiento importado correctamente', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   PATRONES DE DETECCIÓN — CRUD
═══════════════════════════════════════════════════════════════ */

/** Guarda un nuevo patrón de detección */
function guardarPatron() {
  const nombre    = document.getElementById('patronNombre').value.trim();
  const tipo      = document.getElementById('patronTipo').value;
  const categoria = document.getElementById('patronCategoria').value;
  const keywords  = document.getElementById('patronKeywords').value
    .split(',').map(k => k.trim()).filter(Boolean);
  const regex     = document.getElementById('patronRegex').value.trim() || null;

  if (!nombre) {
    showToast('El nombre del patrón es obligatorio.', 'error'); return;
  }
  if (keywords.length === 0) {
    showToast('Agrega al menos una palabra clave.', 'error'); return;
  }

  App.patrones.push({ id: generarId(), nombre, tipo, categoria, keywords, regex });
  persistirPatrones();
  closeModal('modalPatron');
  renderPatrones();
  showToast('Patrón creado correctamente', 'success');
}

/** Elimina un patrón de detección */
function eliminarPatron(id) {
  App.patrones = App.patrones.filter(p => p.id !== id);
  persistirPatrones();
  renderPatrones();
  showToast('Patrón eliminado', 'info');
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTACIÓN — EXCEL (.xlsx) con SheetJS
═══════════════════════════════════════════════════════════════ */
function exportarExcel() {
  if (!App.movimientos.length) {
    showToast('No hay movimientos para exportar.', 'error'); return;
  }

  // Construir datos de la hoja: encabezados + filas
  const datos = [
    ['Fecha', 'Descripción', 'Categoría', 'Cuenta / Banco', 'Tipo', 'Monto'],
    ...App.movimientos.map(m => [
      m.fecha,
      m.descripcion,
      m.categoria || '',
      getNombreCuenta(m.cuentaId),
      m.tipo,
      m.tipo === 'ingreso' ? m.monto : -m.monto
    ])
  ];

  const ws = XLSX.utils.aoa_to_sheet(datos);

  // Estilo de ancho de columnas
  ws['!cols'] = [
    { wch: 12 }, { wch: 35 }, { wch: 20 }, { wch: 25 }, { wch: 10 }, { wch: 15 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');

  // Hoja de resumen por cuenta
  const resumenDatos = [
    ['Cuenta', 'Ingresos', 'Gastos', 'Balance'],
    ...Object.entries(calcularResumenCuentas()).map(([id, d]) => [
      id === '__sin_cuenta__' ? 'Sin cuenta' : getNombreCuenta(id),
      d.ingresos,
      d.gastos,
      d.ingresos - d.gastos
    ])
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenDatos);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  XLSX.writeFile(wb, `finflow_${hoy()}.xlsx`);
  showToast('Archivo Excel generado correctamente', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTACIÓN — PDF con jsPDF + AutoTable
═══════════════════════════════════════════════════════════════ */
function exportarPDF() {
  if (!App.movimientos.length) {
    showToast('No hay movimientos para exportar.', 'error'); return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4' });

  // ─── Encabezado ───
  doc.setFillColor(15, 15, 14);
  doc.rect(0, 0, 297, 30, 'F');
  doc.setTextColor(240, 237, 230);
  doc.setFontSize(18);
  doc.text('FinFlow — Reporte Financiero', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(155, 152, 128);
  doc.text(`Generado: ${new Date().toLocaleDateString('es-DO')}`, 250, 18, { align: 'right' });

  // ─── Resumen ───
  let totalIngresos = 0, totalGastos = 0;
  App.movimientos.forEach(m => {
    if (m.tipo === 'ingreso') totalIngresos += m.monto;
    else if (m.tipo === 'gasto') totalGastos += m.monto;
    // transferencias excluidas intencionalmente
  });
  const balance = totalIngresos - totalGastos;

  doc.setTextColor(30, 30, 26);
  doc.setFontSize(11);
  doc.text(`Balance: ${formatMoney(balance)}   |   Ingresos: ${formatMoney(totalIngresos)}   |   Gastos: ${formatMoney(totalGastos)}`, 14, 40);

  // ─── Tabla de movimientos ───
  doc.autoTable({
    startY: 50,
    head: [['Fecha', 'Descripción', 'Categoría', 'Cuenta', 'Tipo', 'Monto']],
    body: App.movimientos.map(m => [
      formatDate(m.fecha),
      m.descripcion,
      m.categoria || '—',
      getNombreCuenta(m.cuentaId),
      m.tipo.charAt(0).toUpperCase() + m.tipo.slice(1),
      (m.tipo === 'ingreso' ? '+' : '−') + ' ' + formatMoney(m.monto)
    ]),
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 4,
      textColor: [30, 30, 26]
    },
    headStyles: {
      fillColor: [30, 30, 26],
      textColor: [240, 237, 230],
      fontStyle: 'bold'
    },
    alternateRowStyles: { fillColor: [245, 243, 238] },
    didParseCell: (data) => {
      // Colorear la columna de monto según tipo
      if (data.column.index === 5 && data.section === 'body') {
        const row = App.movimientos[data.row.index];
        if (row) {
          data.cell.styles.textColor = row.tipo === 'ingreso' ? [94, 138, 78] : [185, 90, 90];
        }
      }
    }
  });

  doc.save(`finflow_reporte_${hoy()}.pdf`);
  showToast('PDF generado correctamente', 'success');
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════════ */

/** Escapa caracteres HTML para prevenir XSS */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Calcula el resumen de ingresos/gastos agrupado por cuenta.
 *  Las transferencias se muestran como columna separada, no como ingreso/gasto. */
function calcularResumenCuentas() {
  const map = {};
  App.movimientos.forEach(m => {
    const key = m.cuentaId || '__sin_cuenta__';
    if (!map[key]) map[key] = { ingresos: 0, gastos: 0, transferencias: 0 };
    if (m.tipo === 'ingreso')      map[key].ingresos += m.monto;
    else if (m.tipo === 'gasto')   map[key].gastos   += m.monto;
    else if (m.tipo === 'transferencia') map[key].transferencias += m.monto;
  });
  return map;
}

/* ═══════════════════════════════════════════════════════════════
   INICIALIZACIÓN DE LA APLICACIÓN
   Se ejecuta cuando el DOM está completamente cargado
═══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

  // 1. Cargar datos desde localStorage
  cargarDatos();

  // 2. Inicializar selects de categorías con el tipo por defecto
  cargarCategoriasEnSelect('movCategoria', 'ingreso');
  cargarCategoriasEnSelect('patronCategoria', null); // Todas las categorías para patrones

  // 3. Cargar selects de cuentas
  cargarCuentasEnSelects();

  // 4. Renderizar toda la UI
  renderTodo();

  // 5. Mostrar el dashboard por defecto
  showSection('dashboard');

  // 6. Configurar el botón de nueva cuenta para abrir el modal correctamente
  const btnNuevaCuenta = document.querySelector('[onclick="openModal(\'modalCuenta\')"]');
  if (btnNuevaCuenta) {
    btnNuevaCuenta.onclick = prepararNuevaCuenta;
  }

  // 7. Configurar el botón de nuevo movimiento en el header
  const btnNuevoMov = document.querySelector('[onclick="openModal(\'modalMovimiento\')"]');
  if (btnNuevoMov) {
    btnNuevoMov.onclick = prepararNuevoMovimiento;
  }

  // 8. Parchar todos los botones que abren el modal de movimiento
  document.querySelectorAll('[onclick*="openModal(\'modalMovimiento\')"]').forEach(btn => {
    btn.onclick = prepararNuevoMovimiento;
  });
  document.querySelectorAll('[onclick*="openModal(\'modalCuenta\')"]').forEach(btn => {
    btn.onclick = prepararNuevaCuenta;
  });

  console.log('✅ FinFlow iniciado. Datos cargados:', {
    movimientos: App.movimientos.length,
    cuentas: App.cuentas.length,
    patrones: App.patrones.length
  });
});

/* ═══════════════════════════════════════════════════════════════
   NOTAS PARA INTEGRACIÓN FUTURA CON BACKEND

   Para una versión con backend real (Node.js + Express + SQLite):
   
   1. Reemplazar las funciones de localStorage por llamadas fetch():
   
      async function guardarMovimientoAPI(mov) {
        const res = await fetch('/api/movimientos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mov)
        });
        return res.json();
      }
   
   2. Para Gmail/Outlook API con OAuth2:
      - Crear un backend Node.js con passport-google-oauth20
      - Usar imap-simple o googleapis para leer correos
      - Exponer endpoint /api/correos/analizar
   
   3. Estructura del server.js (plantilla incluida por separado):
      - GET  /api/movimientos
      - POST /api/movimientos
      - PUT  /api/movimientos/:id
      - DELETE /api/movimientos/:id
      - GET  /api/cuentas
      - POST /api/cuentas
      - GET  /api/correos/analizar (requiere OAuth)
═══════════════════════════════════════════════════════════════ */