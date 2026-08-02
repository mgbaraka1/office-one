// Migration 050 — bilingual labels for every managed lookup category.
//
// Migration 047 added name_en/name_ar to lookup_codes for client profiles. The
// columns are intentionally reused here: no row, id, code, or relationship is
// replaced. English is backfilled from the canonical label for every category;
// known built-in codes receive an Arabic label. User-created values remain
// untouched so their owners can supply the correct Arabic business wording.
module.exports = {
  version: 50,
  name: 'bilingual_lookup_labels',
  up(db) {
    db.prepare(`
      UPDATE lookup_codes
         SET name_en = label
       WHERE category != 'COMPANY' AND TRIM(COALESCE(name_en, '')) = ''
    `).run();

    const arabic = {
      ACTIVITY_TYPE: {
        TICKET: 'تذكرة', TASK: 'مهمة', MEETING: 'اجتماع', CALL: 'مكالمة', EMAIL: 'بريد إلكتروني',
      },
      TIME_TYPE: {
        WORK_TIME: 'وقت العمل', OVERTIME: 'وقت إضافي', TRAINING: 'تدريب', LEAVE: 'إجازة', HOLIDAY: 'عطلة',
      },
      ENTRY_STATUS: {
        OPEN: 'مفتوحة', IN_PROGRESS: 'قيد التنفيذ', BLOCKED: 'متوقفة', DONE: 'مكتملة',
      },
      CURRENCY: { USD: 'دولار أمريكي', SAR: 'ريال سعودي', EUR: 'يورو' },
      BILLING_CYCLE: { MONTHLY: 'شهري', YEARLY: 'سنوي', CUSTOM: 'مخصص' },
      PROJECT_STATUS: { ACTIVE: 'نشط', ON_HOLD: 'معلّق', COMPLETED: 'مكتمل' },
      PROJECT_DOCUMENT: {
        QUOTATION: 'عرض سعر', QUOTATION_APPROVAL: 'اعتماد عرض السعر',
        PRODUCTION_APPROVED: 'اعتماد الإنتاج', INVOICE: 'فاتورة', INVOICE_PAYMENT: 'سداد الفاتورة',
      },
      COMPANY_DOCUMENT_CATEGORY: {
        LEGAL: 'قانوني', TAX: 'ضريبي', CERTIFICATION: 'شهادة', REGISTRATION: 'تسجيل',
        INSURANCE: 'تأمين', CORPORATE: 'مؤسسي', OTHER: 'أخرى',
      },
      KNOWLEDGE_TYPE: {
        USER_MANUAL: 'دليل المستخدم', INTEGRATION_GUIDE: 'دليل التكامل', SOP: 'إجراء تشغيلي',
        TROUBLESHOOTING: 'استكشاف الأخطاء', TECHNICAL_REFERENCE: 'مرجع تقني',
        TEMPLATE: 'قالب / قائمة تحقق', OTHER: 'أخرى',
      },
      DEPARTMENT: {
        HR: 'الموارد البشرية', CYBERSECURITY: 'الأمن السيبراني', MANAGEMENT: 'الإدارة', FINANCE: 'المالية',
      },
      TASK_SOURCE_TYPE: {
        JIRA: 'جيرا', EMAIL: 'بريد إلكتروني', TEAMS_CHAT: 'تيمز / محادثة',
        MEETING: 'اجتماع', PHONE_CALL: 'مكالمة هاتفية', OTHER: 'أخرى / يدوي',
      },
      SERVER_ROLE: {
        APPLICATIONS: 'تطبيقات', DATABASES: 'قواعد بيانات', SERVICES: 'خدمات',
        RABBITMQ: 'RabbitMQ', APPLICATION_DATABASE: 'تطبيق + قاعدة بيانات',
      },
    };
    const update = db.prepare(`
      UPDATE lookup_codes
         SET name_ar = ?
       WHERE category = ? AND code = ? AND TRIM(COALESCE(name_ar, '')) = ''
    `);
    for (const [category, codes] of Object.entries(arabic)) {
      for (const [code, nameAr] of Object.entries(codes)) update.run(nameAr, category, code);
    }
  },
};
