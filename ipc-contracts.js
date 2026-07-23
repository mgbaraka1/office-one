'use strict';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const NO_ARGS = new Set([
  'auth:status', 'auth:logout', 'auth:listUsers', 'app:version',
  'days:list', 'companies:list', 'systems:list', 'attention:list', 'activity:list',
  'lookups:get', 'subscriptions:list', 'tasks:list', 'tasks:index',
  'projects:list', 'projects:linkable-tasks', 'departments:list',
  'departments:linkable-tasks', 'companydocs:list', 'knowledge:list',
  'knowledge:groups-list', 'clients:list', 'ui:getState', 'db:backup',
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
  'auth:addUser': ['string', 'string', 'boolean'],
  'auth:updateUser': ['id', 'object'],
  'days:range': ['date', 'date'],
  'companies:entries': ['string'],
  'systems:entries': ['string'],
  'analytics:summary': ['date', 'date', 'date', 'date'],
  'analytics:overview': ['date', 'date'],
  'lookups:save': ['object'],
  'subscriptions:save': ['object'],
  'tasks:get': ['id'],
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
  'departments:link-task': ['id', 'id'],
  'departments:unlink-task': ['id'],
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
  'ui:setState': ['object'],
  'maintenance:restoreBackup': ['string'],
  'maintenance:mergeLookups': ['string', 'id', 'id'],
  'maintenance:openBackupFolder': ['string'],
  'report:exportPDF': ['report', 'string'],
  'report:print': ['report'],
  'app:confirmSaveFailure': ['string', 'string?'],
  'window:setTitle': ['string'],
  'shell:openExternal': ['string'],
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
  if (channel === 'report:exportPDF' || channel === 'report:print') {
    if (Buffer.byteLength(args[0], 'utf8') > 10 * 1024 * 1024) throw new Error('Report content is too large');
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
