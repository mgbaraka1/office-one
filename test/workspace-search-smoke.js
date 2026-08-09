'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const db = require('../db');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-search-smoke-'));
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail });

try {
  db.openConnection(root);
  db.applyMigrations();
  const first = db.getUnclaimedUser();
  const userId = first ? first.id : db.createUser('search-owner', 'test-hash', true);
  const otherUserId = db.createUser('search-other', 'test-hash', false);
  const marker = 'NebulaQuasar';
  db.saveLookups(userId, { categories: { COMPANY: [{
    code: 'SEARCH_CLIENT', label: 'Search Client', nameEn: 'Search Client', nameAr: '', isActive: true,
  }] } });

  const task = db.createTask(userId, { name: `${marker} task`, status: 'IN_PROGRESS' });
  db.createTaskSource(userId, task.id, { type: 'EMAIL', ref: `${marker} source subject` });
  const project = db.createProject(userId, { name: `${marker} project`, description: 'Indexed project body' });
  const knowledge = db.createKnowledgeItem(userId, {
    title: `${marker} handbook`, status: 'PUBLISHED', summary: 'Indexed knowledge body',
  });
  const document = db.createCompanyDocument(userId, {
    name: `${marker} certificate`, notes: 'Indexed document body',
  });
  db.saveSubscriptions(userId, {
    subscriptions: [{
      id: 'workspace-search-subscription',
      name: `${marker} subscription`,
      cost: 12,
      currency: 'USD',
      billingCycle: 'MONTHLY',
      renewalDate: '2099-01-01',
    }],
    defaultCurrency: 'USD',
  });
  db.createKnowledgeItem(otherUserId, { title: `${marker} private other-user item` });
  const company = db.getLookupsByCategory('COMPANY', true)[0];
  const vpn = db.createClientVpn(userId, company.id, {
    connectionName: `${marker} secure access`, vpnType: 'VPN', endpoint: 'vpn.nebula.invalid',
    password: 'SecretNeverIndexedToken', notes: 'Indexed access metadata',
  });
  db.createClientVpn(otherUserId, company.id, {
    connectionName: `${marker} other-user access`, vpnType: 'VPN', endpoint: 'private.invalid',
  });

  const hits = db.searchWorkspace(userId, marker.toLowerCase(), 50);
  const keys = new Set(hits.map(hit => `${hit.kind}:${hit.id}`));
  check('FTS finds all five indexed workspace domains',
    keys.has(`task:${task.id}`)
      && keys.has(`project:${project.id}`)
      && keys.has(`knowledge:${knowledge.id}`)
      && keys.has(`company-document:${document.id}`)
      && keys.has('subscription:workspace-search-subscription')
      && keys.has(`client-auth:${company.id}:${vpn.id}`),
    JSON.stringify(hits));
  check('Search results are isolated to the authenticated owner',
    !hits.some(hit => hit.title.includes('other-user')), JSON.stringify(hits));
  check('Client infrastructure search never indexes credentials',
    db.searchWorkspace(userId, 'SecretNeverIndexedToken', 10).length === 0);

  db.updateKnowledgeItem(userId, knowledge.id, {
    title: 'Renamed searchable handbook',
    status: 'PUBLISHED',
    summary: 'OrionUpdatedToken',
  });
  check('Update triggers replace stale FTS content',
    db.searchWorkspace(userId, marker).every(hit => hit.id !== knowledge.id || hit.kind !== 'knowledge')
      && db.searchWorkspace(userId, 'OrionUpdatedToken').some(hit => hit.id === knowledge.id && hit.kind === 'knowledge'));

  db.deleteCompanyDocument(userId, document.id);
  check('Delete triggers remove the result immediately',
    !db.searchWorkspace(userId, marker).some(hit => hit.id === document.id && hit.kind === 'company-document'));

  const bounded = db.searchWorkspace(userId, '', 2);
  check('Blank-query recent results obey the server-side limit', bounded.length <= 2, JSON.stringify(bounded));
  check('FTS query builder treats punctuation as data, not executable syntax',
    Array.isArray(db.searchWorkspace(userId, '" OR * : NEAR(', 10)));
  const activity = db.getRecentActivity(userId);
  check('Recent Changes unifies workspace updates without cross-account leakage',
    activity.some(item => item.kind === 'knowledge' && item.id === knowledge.id)
      && activity.some(item => item.kind === 'project' && item.id === project.id)
      && !activity.some(item => item.title.includes('other-user')),
    JSON.stringify(activity));
  const diagnostics = db.getSystemDiagnostics();
  check('Recovery diagnostics cover integrity, schema, files, search, and storage',
    diagnostics.integrity.ok
      && diagnostics.schemaHead === 52
      && diagnostics.workspaceSearchRows >= 1
      && Array.isArray(diagnostics.missingFiles)
      && Object.hasOwn(diagnostics, 'freeBytes')
      && diagnostics.credentialPortability.includes('Windows account'),
    JSON.stringify(diagnostics));
} catch (error) {
  checks.push({ name: 'Workspace search smoke completed', pass: false, detail: error.stack || String(error) });
} finally {
  try { db.close(); } catch {}
  fs.rmSync(root, { recursive: true, force: true });
}

for (const item of checks) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? `  (${item.detail})` : ''}`);
}
const failed = checks.filter(item => !item.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} workspace-search gates passed.`);
process.exitCode = failed ? 1 : 0;
