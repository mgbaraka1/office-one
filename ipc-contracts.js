'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NO_ARGS = new Set([
  'auth:status', 'auth:logout', 'auth:listUsers', 'app:version',
  'days:list', 'companies:list', 'systems:list', 'attention:list', 'activity:list',
  'lookups:get', 'subscriptions:list', 'tasks:list', 'tasks:index',
  'projects:list', 'projects:linkable-tasks', 'departments:list',
  'internal:list', 'companydocs:list', 'knowledge:list',
  'knowledge:groups-list', 'clients:list', 'ui:getState', 'db:backup',
  'finance:lookups-list', 'finance:clients-list',
  'ui:getKnowledgeDraft', 'ui:clearKnowledgeDraft', 'preferences:get',
  'maintenance:listBackups', 'maintenance:integrityCheck',
  'maintenance:diagnostics',
  'maintenance:lookupDuplicates', 'maintenance:orphanSweepReport',
  'maintenance:fullBackup', 'maintenance:selectFullBackup',
  'maintenance:restoreSelectedFullBackup', 'app:flushComplete',
  'app:cancelClose', 'security:credentialEncryptionStatus',
]);

const SIGNATURES = {
  'auth:setup': ['string', 'string'],
  'auth:login': ['string', 'string'],
  'auth:addUser': ['string', 'string', 'boolean', 'string?', 'string?'],
  'auth:updateUser': ['id', 'object'],
  'days:range': ['date', 'date'],
  'companies:entries': ['string'],
  'systems:entries': ['string'],
  'analytics:summary': ['date', 'date', 'date', 'date'],
  'analytics:overview': ['date', 'date'],
  'lookups:save': ['object'],
  'ui:saveKnowledgeDraft': ['object'],
  'preferences:set': ['string', 'string'],
  'subscriptions:save': ['object'],
  'tasks:get': ['id'],
  'tasks:history': ['id'],
  'search:workspace': ['string', 'id?'],
  'tasks:create': ['object'],
  'tasks:update': ['id', 'object'],
  'tasks:update-meta': ['id', 'object'],
  'tasks:delete': ['id'],
  'tasks:merge': ['id', 'id'],
  'tasks:source-create': ['id', 'object'],
  'tasks:source-update': ['id', 'object'],
  'tasks:source-delete': ['id'],
  'worklogs:byDate': ['date'],
  'worklogs:add': ['id', 'object'],
  'worklogs:update': ['id', 'object'],
  'worklogs:move': ['id', 'id'],
  'worklogs:delete': ['id'],
  'worklogs:history': ['id'],
  'day:setName': ['date', 'string'],
  'day:getName': ['date'],
  'projects:create': ['object'],
  'projects:get': ['id'],
  'projects:update': ['id', 'object'],
  'projects:delete': ['id'],
  'projects:link-task': ['id', 'id'],
  'projects:unlink-task': ['id'],
  'departments:get': ['id'],
  'internal:create': ['object'],
  'internal:update': ['id', 'object'],
  'internal:delete': ['id'],
  'internal:convert-to-client': ['id', 'object'],
  'tasks:convert-to-internal': ['id', 'object'],
  'projects:upload-document': ['id', 'string'],
  'projects:download-document': ['id', 'string'],
  'projects:open-document': ['id', 'string'],
  'projects:remove-document': ['id', 'string'],
  'projects:restore-document': ['id', 'string', 'object'],
  'projects:purge-document-file': ['id', 'string'],
  'projects:purge-files': ['id'],
  'projects:restore-files': ['id', 'id', 'array'],
  'companydocs:create': ['object'],
  'companydocs:update': ['id', 'object'],
  'companydocs:delete': ['id'],
  'companydocs:upload-document': ['id'],
  'companydocs:download-document': ['id'],
  'companydocs:open-document': ['id'],
  'companydocs:remove-document': ['id'],
  'companydocs:restore-document': ['id', 'object'],
  'companydocs:purge-document-file': ['id', 'string'],
  'companydocs:purge-files': ['id'],
  'companydocs:restore-file': ['id', 'id', 'object'],
  'knowledge:get': ['id'],
  'knowledge:create': ['object'],
  'knowledge:update': ['id', 'object'],
  'knowledge:delete': ['id'],
  'knowledge:restore': ['id', 'object'],
  'knowledge:group-create': ['object'],
  'knowledge:group-update': ['id', 'object'],
  'knowledge:group-delete': ['id'],
  'knowledge:upload-attachment': ['id', 'object'],
  'knowledge:download-attachment': ['id'],
  'knowledge:open-attachment': ['id'],
  'knowledge:remove-attachment': ['id'],
  'knowledge:restore-attachment': ['id', 'object'],
  'knowledge:purge-attachment': ['id', 'string'],
  'knowledge:purge-files': ['id'],
  'clients:get': ['id'],
  'clients:vpn-create': ['id', 'object'],
  'clients:vpn-update': ['id', 'object'],
  'clients:vpn-delete': ['id'],
  'clients:server-create': ['id', 'object'],
  'clients:server-update': ['id', 'object'],
  'clients:server-delete': ['id'],
  'clients:server-rename-group': ['id', 'string', 'string'],
  'clients:server-assign-group': ['id', 'array', 'string'],
  'clients:internal-create': ['id', 'object'],
  'clients:internal-update': ['id', 'object'],
  'clients:internal-delete': ['id'],
  'clients:internal-rename-group': ['id', 'string', 'string'],
  'clients:internal-assign-group': ['id', 'array', 'string'],
  'clients:field-history': ['string', 'id'],
  'clients:profile-get': ['id'],
  'clients:profile-save': ['id', 'object'],
  'clients:profile-history': ['id'],
  'finance:candidate-companies': [],
  'finance:overview': [],
  'finance:lookups-save': ['object'],
  'finance:client-get': ['id'],
  'finance:client-create': ['object'],
  'finance:client-update': ['id', 'object'],
  'finance:client-delete': ['id'],
  'finance:contracts-list': ['id'],
  'finance:contract-get': ['id'],
  'finance:contract-create': ['id', 'object'],
  'finance:contract-update': ['id', 'object'],
  'finance:contract-delete': ['id'],
  'finance:version-create': ['id', 'object'],
  'finance:version-update': ['id', 'object'],
  'finance:version-delete': ['id'],
  'finance:version-set-final': ['id'],
  'finance:installment-create': ['id', 'object'],
  'finance:installment-update': ['id', 'object'],
  'finance:installment-delete': ['id'],
  'finance:crs-list': ['id'],
  'finance:cr-get': ['id'],
  'finance:cr-create': ['id', 'object'],
  'finance:cr-update': ['id', 'object'],
  'finance:cr-delete': ['id'],
  'finance:invoices-list': ['id'],
  'finance:invoice-get': ['id'],
  'finance:invoice-create': ['id', 'object'],
  'finance:invoice-update': ['id', 'object'],
  'finance:invoice-delete': ['id'],
  'finance:invoice-link-create': ['id', 'object'],
  'finance:invoice-link-delete': ['id'],
  'finance:payment-create': ['id', 'object'],
  'finance:payment-update': ['id', 'object'],
  'finance:payment-delete': ['id'],
  'finance:summary': ['id'],
  'finance:attachments-list': ['string', 'id'],
  'finance:attachment-upload': ['string', 'id'],
  'finance:attachment-download': ['id'],
  'finance:attachment-open': ['id'],
  'finance:attachment-delete': ['id'],
  'finance:attachment-restore': ['object'],
  'finance:attachment-purge': ['string', 'id', 'string'],
  'finance:meetings-list': ['id'],
  'finance:meeting-get': ['id'],
  'finance:meeting-create': ['id', 'object'],
  'finance:meeting-update': ['id', 'object'],
  'finance:meeting-delete': ['id'],
  'finance:action-create': ['id', 'object'],
  'finance:action-update': ['id', 'object'],
  'finance:action-toggle': ['id'],
  'finance:action-delete': ['id'],
  'finance:report-export-excel': ['object', 'string'],
  'ui:setState': ['object'],
  'maintenance:restoreBackup': ['string'],
  'maintenance:mergeLookups': ['string', 'id', 'id'],
  'maintenance:openBackupFolder': ['string'],
  'report:exportPDF': ['report', 'string'],
  'report:exportCSV': ['report', 'string'],
  'report:exportExcel': ['object', 'string'],
  'report:print': ['report'],
  'app:confirmSaveFailure': ['string', 'string?'],
  'window:setTitle': ['string'],
  'shell:openExternal': ['string'],
  'security:copySecret': ['string'],
};

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function validateValue(value, depth = 0, budget = { nodes: 0, textBytes: 0 }) {
  if (++budget.nodes > 50_000 || depth > 10) throw new Error('IPC payload is too complex');
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value === 'string') {
    budget.textBytes += Buffer.byteLength(value, 'utf8');
    if (budget.textBytes > 12 * 1024 * 1024) throw new Error('IPC payload is too large');
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new Error('IPC array is too large');
    value.forEach(item => validateValue(item, depth + 1, budget));
    return;
  }
  if (!isPlainObject(value)) throw new Error('IPC payload contains an unsupported value');
  const keys = Object.keys(value);
  if (keys.length > 500) throw new Error('IPC object has too many fields');
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('IPC payload contains an unsafe field');
    }
    validateValue(value[key], depth + 1, budget);
  }
}

function matches(type, value) {
  const optional = type.endsWith('?');
  const base = optional ? type.slice(0, -1) : type;
  if (optional && value === undefined) return true;
  if (base === 'string' || base === 'report') return typeof value === 'string';
  if (base === 'boolean') return typeof value === 'boolean';
  if (base === 'id') return Number.isInteger(Number(value)) && Number(value) > 0;
  if (base === 'date') return validDate(value);
  if (base === 'object') return isPlainObject(value);
  if (base === 'array') return Array.isArray(value);
  return false;
}

function hasContract(channel) {
  return NO_ARGS.has(channel) || Object.hasOwn(SIGNATURES, channel);
}

function validateIpcArgs(channel, args) {
  if (!hasContract(channel)) throw new Error(`No IPC contract registered for ${channel}`);
  if (!Array.isArray(args)) throw new Error('IPC arguments must be an array');
  const signature = NO_ARGS.has(channel) ? [] : SIGNATURES[channel];
  const required = signature.filter(type => !type.endsWith('?')).length;
  if (args.length < required || args.length > signature.length) {
    throw new Error(`Invalid IPC argument count for ${channel}`);
  }
  validateValue(args);
  signature.forEach((type, index) => {
    if (!matches(type, args[index])) throw new Error(`Invalid IPC argument ${index + 1} for ${channel}`);
  });
  if (channel === 'report:exportPDF' || channel === 'report:exportCSV' || channel === 'report:print') {
    if (Buffer.byteLength(args[0], 'utf8') > 10 * 1024 * 1024) throw new Error('Report content is too large');
  } else if (channel === 'report:exportExcel' || channel === 'finance:report-export-excel') {
    if (Buffer.byteLength(JSON.stringify(args[0]), 'utf8') > 10 * 1024 * 1024) throw new Error('Report content is too large');
  } else {
    for (const arg of args) {
      if (typeof arg === 'string' && Buffer.byteLength(arg, 'utf8') > 1024 * 1024) {
        throw new Error(`IPC string is too large for ${channel}`);
      }
    }
  }
  return true;
}

module.exports = { hasContract, validateIpcArgs, validDate };
