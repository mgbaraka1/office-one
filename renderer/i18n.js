/* Cooperation Tools localization.
 *
 * English remains the source language used by the existing renderer. This
 * small runtime translates UI-only strings and observes feature renderers so
 * newly opened modals/cards are localized too. Records, input values and
 * catalog labels are not modified.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ct-language';
  const SUPPORTED = new Set(['en', 'ar']);
  const ar = {
    'Cooperation Tools': 'أدوات التعاون', 'Choose language': 'اختر اللغة',
    'Welcome back': 'مرحباً بعودتك', 'Log in to continue': 'سجّل الدخول للمتابعة',
    'Create your account': 'أنشئ حسابك', 'This is the first account on this device': 'هذا أول حساب على هذا الجهاز',
    'Username': 'اسم المستخدم', 'Password': 'كلمة المرور', 'Confirm password': 'تأكيد كلمة المرور',
    'Log in': 'تسجيل الدخول', 'Create account': 'إنشاء حساب', 'Passwords do not match.': 'كلمتا المرور غير متطابقتين.',
    'Track': 'التتبع', 'Today': 'اليوم', 'Tasks': 'المهام', 'Clients & Assets': 'العملاء والأصول',
    'Clients': 'العملاء', 'Subscriptions': 'الاشتراكات', 'Company Docs': 'مستندات الشركة',
    'Company Documents': 'مستندات الشركة', 'Knowledge Hub': 'مركز المعرفة', 'Review': 'المراجعة',
    'Overview': 'نظرة عامة', 'Reports': 'التقارير', 'Administration': 'الإدارة', 'Settings': 'الإعدادات',
    'Quick Find': 'البحث السريع', 'Create New': 'إنشاء جديد', 'View & Comfort': 'العرض والراحة',
    'Dark Mode': 'الوضع الداكن', 'Light Mode': 'الوضع الفاتح', 'Backup Data': 'نسخ البيانات احتياطياً',
    'Switch to Arabic': 'التبديل إلى العربية', 'Switch to English': 'التبديل إلى الإنجليزية',
    'Log Out': 'تسجيل الخروج', 'Signed-in account': 'الحساب المسجّل', 'Primary navigation': 'التنقل الرئيسي',
    'This Week': 'هذا الأسبوع', 'This Month': 'هذا الشهر', 'This Year': 'هذه السنة', 'Custom': 'مخصص',
    'Refresh': 'تحديث', 'Hours Logged': 'الساعات المسجلة', 'Daily Hours': 'الساعات اليومية',
    'Daily Over Time': 'الوقت الإضافي اليومي', 'Recurring Spend': 'الإنفاق المتكرر',
    'Upcoming Renewals': 'التجديدات القادمة', 'Needs Attention': 'تحتاج إلى انتباه',
    'Time Breakdown': 'توزيع الوقت', 'Hours by Company': 'الساعات حسب الشركة',
    'Hours by System': 'الساعات حسب النظام', 'Hours by Department': 'الساعات حسب القسم',
    'By Task': 'حسب المهمة', 'By Activity': 'حسب النشاط', 'More breakdowns and yearly activity': 'تفاصيل إضافية والنشاط السنوي',
    'Recent Changes': 'التغييرات الأخيرة', 'Your offline audit trail': 'سجل التغييرات دون اتصال',
    'No records yet — click': 'لا توجد سجلات بعد — انقر', 'to start': 'للبدء',
    'Timesheet': 'سجل الدوام', '+ Add Record': '+ إضافة سجل', 'Add Record': 'إضافة سجل',
    'Add a session to today’s Timesheet': 'أضف جلسة إلى سجل دوام اليوم', 'Continue': 'متابعة',
    'Previous / next saved day (Timesheet)': 'اليوم السابق / التالي المحفوظ في سجل الدوام',
    'Employee Name': 'اسم الموظف', 'Time Tracking': 'تتبع الوقت', 'Record': 'السجل',
    'Date': 'التاريخ', 'Day': 'اليوم', 'Month': 'الشهر', 'Time': 'الوقت', 'Minutes': 'الدقائق',
    'Description': 'الوصف', 'Status': 'الحالة', 'Company': 'الشركة', 'System': 'النظام',
    'Project': 'المشروع', 'Department': 'القسم', 'Natural': 'طبيعة العمل', 'Time Type': 'نوع الوقت',
    'Work Time': 'وقت العمل', 'Over Time': 'وقت إضافي', 'Done': 'مكتمل', 'Open': 'مفتوح', 'Blocked': 'متوقف',
    'Add Task': 'إضافة مهمة', 'New Task': 'مهمة جديدة', 'Existing Task': 'مهمة موجودة',
    'Task Details': 'تفاصيل المهمة', 'New Task Details': 'تفاصيل المهمة الجديدة', 'Task Name': 'اسم المهمة',
    'Task Type': 'نوع المهمة', 'All Tasks': 'كل المهام', 'Internal': 'داخلي', 'Sources': 'المصادر',
    '+ Add Source': '+ إضافة مصدر', 'More options': 'خيارات إضافية', 'Advanced details': 'تفاصيل متقدمة',
    'Session Details': 'تفاصيل الجلسة', 'New Session Details': 'تفاصيل الجلسة الجديدة', 'Edit Session': 'تعديل الجلسة',
    'Sessions': 'الجلسات', 'Log Work': 'تسجيل عمل', 'Log work': 'تسجيل عمل', 'Save': 'حفظ',
    'Save Changes': 'حفظ التغييرات', 'Cancel': 'إلغاء', 'Close': 'إغلاق', 'Delete': 'حذف',
    'Edit': 'تعديل', 'Undo': 'تراجع', 'Discard': 'تجاهل', 'Reset': 'إعادة ضبط', 'Preview': 'معاينة',
    'Print': 'طباعة', 'Save PDF': 'حفظ PDF', 'Generate →': 'إنشاء ←', 'Clear filters': 'مسح عوامل التصفية',
    'Search': 'بحث', 'Browse': 'تصفح', 'Name': 'الاسم', 'Title': 'العنوان', 'Summary': 'الملخص',
    'Notes': 'ملاحظات', 'Type': 'النوع', 'Category': 'الفئة', 'Activity': 'النشاط', 'Hours': 'الساعات',
    'Cost': 'التكلفة', 'Currency': 'العملة', 'Billing Cycle': 'دورة الفوترة', 'End Date': 'تاريخ الانتهاء',
    'Renewal Date': 'تاريخ التجديد', 'Renews In': 'يتجدد خلال', '+ Add Subscription': '+ إضافة اشتراك',
    'Add Subscription': 'إضافة اشتراك', 'Subscription deleted': 'تم حذف الاشتراك',
    'No subscriptions yet — click': 'لا توجد اشتراكات بعد — انقر', 'to start tracking': 'لبدء التتبع',
    'Subscriptions Settings': 'إعدادات الاشتراكات', 'Default Currency': 'العملة الافتراضية',
    'Companies': 'الشركات', 'Systems': 'الأنظمة', 'Departments': 'الأقسام', 'Project Status': 'حالة المشروع',
    'Client Profile': 'ملف العميل', 'Add Client Profile': 'إضافة ملف عميل',
    'Company Code': 'رمز الشركة', 'English Name': 'الاسم بالإنجليزية', 'Arabic Name': 'الاسم بالعربية',
    'English company name': 'اسم الشركة بالإنجليزية', 'اسم الشركة بالعربية': 'اسم الشركة بالعربية',
    'Each client profile has a unique business code plus English and Arabic names. Tasks, projects, and infrastructure stay linked when these values change.': 'لكل ملف عميل رمز عمل فريد واسم بالإنجليزية واسم بالعربية. تظل المهام والمشاريع والبنية التحتية مرتبطة عند تغيير هذه القيم.',
    'Project Documents': 'مستندات المشروع', 'Project Name': 'اسم المشروع', 'Create Project': 'إنشاء مشروع',
    'New Project': 'مشروع جديد', 'Create project': 'إنشاء مشروع', 'Project deleted': 'تم حذف المشروع',
    'Client / Project work': 'عمل العميل / المشروع', 'Open Client': 'فتح العميل', 'Add System': 'إضافة نظام',
    'Add Server': 'إضافة خادم', 'Add Internal System': 'إضافة نظام داخلي', 'Add Connection': 'إضافة اتصال',
    'Add Auth Connection': 'إضافة اتصال مصادقة', 'Connection Name': 'اسم الاتصال', 'Environment': 'البيئة',
    'Production': 'الإنتاج', 'UAT': 'اختبار القبول', 'IP Address': 'عنوان IP', 'Hostname': 'اسم المضيف',
    'Port': 'المنفذ', 'Operating System': 'نظام التشغيل', 'Role': 'الدور', 'Password': 'كلمة المرور',
    'Endpoint / URL': 'نقطة الاتصال / الرابط', 'Expiry Date (optional)': 'تاريخ الانتهاء (اختياري)',
    'Credential Location (optional)': 'موقع بيانات الدخول (اختياري)', 'Secret Key (optional)': 'المفتاح السري (اختياري)',
    'Company Code (optional)': 'رمز الشركة (اختياري)', 'No companies yet — add one in': 'لا توجد شركات بعد — أضف واحدة من',
    'Knowledge item deleted': 'تم حذف عنصر المعرفة', 'New Knowledge Item': 'عنصر معرفة جديد',
    'Create Item': 'إنشاء عنصر', 'Write an article': 'كتابة مقال', 'Write knowledge': 'كتابة معرفة',
    'Search Knowledge Hub': 'البحث في مركز المعرفة', 'No knowledge found': 'لم يتم العثور على معرفة',
    'Ready': 'جاهز', 'Draft': 'مسودة', 'Archived': 'مؤرشف', 'Tags': 'الوسوم', 'Groups': 'المجموعات',
    'Group Name': 'اسم المجموعة', 'Create Group': 'إنشاء مجموعة', 'New Group': 'مجموعة جديدة',
    'Contents': 'المحتوى', 'History': 'السجل', 'Document Name': 'اسم المستند', 'Version': 'الإصدار',
    'Choose File': 'اختيار ملف', 'Upload a document': 'رفع مستند', 'Add Document': 'إضافة مستند',
    'New Document': 'مستند جديد', '+ New Document': '+ مستند جديد', 'Document deleted': 'تم حذف المستند',
    'Account & Preferences': 'الحساب والتفضيلات', 'Catalogs': 'الكتالوجات', 'Data & Recovery': 'البيانات والاستعادة',
    'General': 'عام', 'Language': 'اللغة', 'English': 'الإنجليزية', 'Application language': 'لغة التطبيق',
    'Choose the interface language. Arabic uses a right-to-left layout; your records and catalog names are never translated or changed.': 'اختر لغة الواجهة. تستخدم العربية تخطيطاً من اليمين إلى اليسار؛ ولن تتم ترجمة سجلاتك أو أسماء الكتالوجات أو تغييرها.',
    'Start on': 'البدء عند', 'Last page': 'آخر صفحة', 'Analytics': 'التحليلات',
    'User Management': 'إدارة المستخدمين', 'Add User': 'إضافة مستخدم', 'Edit User': 'تعديل المستخدم',
    'Permissions': 'الصلاحيات', 'Account status': 'حالة الحساب', 'Active — can sign in': 'نشط — يمكنه تسجيل الدخول',
    'Current password': 'كلمة المرور الحالية', 'New password': 'كلمة المرور الجديدة', 'Save User': 'حفظ المستخدم',
    'Standard User': 'مستخدم عادي', 'Administrator': 'مسؤول',
    'Standard User — own data and preferences': 'مستخدم عادي — بياناته وتفضيلاته فقط',
    'Administrator — full settings, backup and user access': 'مسؤول — وصول كامل إلى الإعدادات والنسخ الاحتياطي والمستخدمين',
    'Companies': 'الشركات', 'Company Doc Categories': 'فئات مستندات الشركة', 'Knowledge Types': 'أنواع المعرفة',
    'Task Source Types': 'أنواع مصادر المهام', 'Server Roles': 'أدوار الخوادم', 'Maintenance': 'الصيانة',
    'Save Catalog Changes': 'حفظ تغييرات الكتالوج', 'Full Backup': 'نسخة احتياطية كاملة',
    'Back Up Everything to Desktop': 'نسخ كل شيء إلى سطح المكتب', 'Restore Everything…': 'استعادة كل شيء…',
    'Recovery Readiness': 'جاهزية الاستعادة', 'Run Audit': 'تشغيل التدقيق', 'Backups': 'النسخ الاحتياطية',
    'Run Check': 'تشغيل الفحص', 'Integrity Check': 'فحص السلامة', 'Orphan File Sweep': 'تنظيف الملفات غير المرتبطة',
    'Lookup Duplicates': 'تكرارات الكتالوج', 'Scan': 'فحص', 'Merge': 'دمج',
    'Workspace View': 'عرض مساحة العمل', 'Density': 'الكثافة', 'Comfort': 'الراحة', 'Compact': 'مدمج',
    'Balanced': 'متوازن', 'Spacious': 'واسع', 'Motion': 'الحركة', 'Gentle': 'لطيفة', 'Static': 'ثابتة',
    'Focus Mode': 'وضع التركيز', 'Enter Focus': 'بدء التركيز', 'Exit Focus': 'إنهاء التركيز',
    'Keyboard Shortcuts': 'اختصارات لوحة المفاتيح', 'Find Anything': 'البحث عن أي شيء',
    'Create something': 'إنشاء شيء', 'Quick actions': 'إجراءات سريعة', 'Recently updated': 'تم تحديثها مؤخراً',
    'Recently created': 'تم إنشاؤها مؤخراً', 'No matches': 'لا توجد نتائج', 'No results': 'لا توجد نتائج',
    'How This App Thinks': 'كيف يعمل هذا التطبيق', 'Three ideas explain almost everything else in this app.': 'ثلاث أفكار تشرح تقريباً كل ما في هذا التطبيق.',
    'A Task': 'المهمة', 'A Session': 'الجلسة', 'Close the open modal / palette / menu': 'إغلاق النافذة أو لوحة الأوامر أو القائمة المفتوحة',
    'Save the open Add/Edit modal': 'حفظ نافذة الإضافة / التعديل المفتوحة', 'Something went wrong. Please try again.': 'حدث خطأ. يرجى المحاولة مرة أخرى.',
    'Login failed.': 'فشل تسجيل الدخول.', 'Could not log out.': 'تعذر تسجيل الخروج.', 'Settings saved': 'تم حفظ الإعدادات',
    'Monday': 'الاثنين', 'Tuesday': 'الثلاثاء', 'Wednesday': 'الأربعاء', 'Thursday': 'الخميس',
    'Friday': 'الجمعة', 'Saturday': 'السبت', 'Sunday': 'الأحد', 'Mon': 'الاثنين', 'Tue': 'الثلاثاء',
    'Wed': 'الأربعاء', 'Thu': 'الخميس', 'Fri': 'الجمعة', 'Sat': 'السبت', 'Sun': 'الأحد',
    'Daily Timesheet PDF': 'تقرير سجل الدوام اليومي', 'Monthly Over-Time PDF': 'تقرير الوقت الإضافي الشهري',
    'Subscriptions PDF': 'تقرير الاشتراكات', 'Repeat Last': 'تكرار الأخير', 'Stop': 'إيقاف',
    'Less': 'أقل', 'More': 'المزيد', 'Task': 'المهمة', 'Project / Dept': 'المشروع / القسم',
    '‹ Prev': 'السابق ›', 'Next ›': '‹ التالي', 'Row deleted': 'تم حذف السجل',
    'Create guidance, steps, or troubleshooting notes': 'إنشاء إرشادات أو خطوات أو ملاحظات لاستكشاف الأخطاء',
    'Create an item and attach its first version': 'إنشاء عنصر وإرفاق إصداره الأول',
    'Sort knowledge items': 'ترتيب عناصر المعرفة', 'Most documents': 'الأكثر مستندات',
    'An unsaved draft is available for this item.': 'تتوفر مسودة غير محفوظة لهذا العنصر.',
    'Recover': 'استعادة', 'Link': 'ربط', 'Include Knowledge Items': 'تضمين عناصر المعرفة',
    'Reuse an existing document name when uploading a newer version.': 'أعد استخدام اسم مستند موجود عند رفع إصدار أحدث.',
    'After continuing, choose the document file from your computer.': 'بعد المتابعة، اختر ملف المستند من جهازك.',
    'No company documents yet — click': 'لا توجد مستندات شركة بعد — انقر', 'to add one': 'لإضافة مستند',
    'System (optional)': 'النظام (اختياري)', 'Integration and advanced details': 'تفاصيل التكامل والتفاصيل المتقدمة',
    'Role / Purpose (optional)': 'الدور / الغرض (اختياري)',
    'Sub-Services (optional) — sibling endpoints of this one service': 'الخدمات الفرعية (اختياري) — نقاط اتصال تابعة لهذه الخدمة',
    '+ Add Sub-Service': '+ إضافة خدمة فرعية', 'Rename System Group': 'إعادة تسمية مجموعة النظام',
    'Move these servers to system': 'نقل هذه الخوادم إلى النظام', 'Include Records': 'تضمين السجلات',
    'Confirm Changes': 'تأكيد التغييرات', 'Confirm & Save': 'تأكيد وحفظ',
    'You\'re changing the following field(s) on this existing record:': 'أنت تغيّر الحقول التالية في هذا السجل:',
    'Link an Existing Task': 'ربط مهمة موجودة', 'Merge Task': 'دمج المهمة',
    'Move every session from': 'نقل جميع الجلسات من', 'Merge into': 'الدمج في',
    'Find a setting': 'البحث عن إعداد', 'Required only when changing your own password.': 'مطلوبة فقط عند تغيير كلمة مرورك.',
    'Moving to another PC or Windows account?': 'هل تنتقل إلى جهاز أو حساب Windows آخر؟',
    'Choose how much information fits on screen.': 'اختر مقدار المعلومات التي تظهر على الشاشة.',
    'Scan more at once': 'عرض المزيد في وقت واحد', 'Everyday comfort': 'راحة يومية', 'More breathing room': 'مساحة أوسع',
    'Canvas': 'الخلفية', 'Control the amount of background structure.': 'تحكم في مقدار تفاصيل الخلفية.',
    'Calm': 'هادئ', 'Clean, quiet surfaces': 'أسطح نظيفة وهادئة', 'Structured': 'منظم',
    'Subtle alignment grid': 'شبكة محاذاة خفيفة', 'Reduce movement when concentration matters.': 'قلل الحركة عند الحاجة إلى التركيز.',
    'Soft interface feedback': 'استجابة مرئية لطيفة', 'No decorative movement': 'دون حركة زخرفية',
    'Create task': 'إنشاء مهمة', 'Plan project, department, or unlinked work': 'خطط لعمل مشروع أو قسم أو عمل غير مرتبط',
    'Connect clients, systems, documents, and tasks': 'اربط العملاء والأنظمة والمستندات والمهام',
    'Capture a manual, procedure, or technical note': 'سجّل دليلاً أو إجراءً أو ملاحظة فنية',
    'Add knowledge document': 'إضافة مستند معرفة', 'Start a versioned document library item': 'بدء عنصر مستند متعدد الإصدارات',
    'Add company document': 'إضافة مستند شركة', 'Track a company record and renewal date': 'تتبع سجل شركة وتاريخ تجديده',
    'Add subscription': 'إضافة اشتراك', 'Track recurring cost and renewal timing': 'تتبع التكلفة المتكررة وموعد التجديد',
    'Find existing work': 'البحث عن عمل موجود', 'Jump to a task, client, project, document, or date': 'انتقل إلى مهمة أو عميل أو مشروع أو مستند أو تاريخ',
    'Open the command palette': 'فتح لوحة الأوامر', 'Open the universal Create Hub': 'فتح مركز الإنشاء العام',
    'Enter or exit Focus Mode': 'الدخول إلى وضع التركيز أو الخروج منه', 'Show this shortcuts list': 'عرض قائمة الاختصارات',
    'Cycle focus within the open modal': 'التنقل بين عناصر النافذة المفتوحة',
    'the job to be done': 'العمل المطلوب', 'time logged on dates': 'الوقت المسجل في التواريخ',
    'client/system work': 'عمل العميل / النظام', 'internal work': 'عمل داخلي', 'optional,': 'اختياري،', 'never both': 'وليس كليهما',
    'A Task\'s container is optional and exclusive': 'حاوية المهمة اختيارية وحصرية',
    'Continue something you worked on recently': 'متابعة عمل اشتغلت عليه مؤخراً',
    'Start brand-new client/system work': 'بدء عمل جديد لعميل / نظام', 'Wrap up something you finished': 'إنهاء عمل أكملته',
    'Generate ready-to-share PDF reports. A preview opens first — then Print or Save as PDF.': 'أنشئ تقارير PDF جاهزة للمشاركة. تفتح المعاينة أولاً، ثم يمكنك الطباعة أو الحفظ بصيغة PDF.',
    'The full daily work report for a single day — every record with its hours and the Work / Over-Time split. The same report you can print from the Timesheet.': 'تقرير العمل اليومي الكامل ليوم واحد، ويشمل كل سجل وساعاته وتقسيم وقت العمل والوقت الإضافي. وهو نفس التقرير الذي يمكن طباعته من سجل الدوام.',
    'Every Over-Time entry logged in the chosen month, with the total hours — formatted as an Over-Time Request to share with management for approval.': 'كل إدخال وقت إضافي في الشهر المحدد مع إجمالي الساعات، منسقاً كطلب وقت إضافي لمشاركته مع الإدارة واعتماده.',
    'The full list of recurring subscriptions — cost, billing cycle, end & renewal dates and how soon each renews, with monthly / yearly spend totals per currency.': 'القائمة الكاملة للاشتراكات المتكررة، بما فيها التكلفة ودورة الفوترة وتواريخ الانتهاء والتجديد وموعد كل تجديد، مع إجماليات الإنفاق الشهرية والسنوية لكل عملة.',
    'Only a session (date, time, natural, description, minutes) is added — the task itself is never changed.': 'تُضاف جلسة فقط (التاريخ والوقت وطبيعة العمل والوصف والدقائق)، ولا تتغير المهمة نفسها.',
    'Create a manual, integration guide, procedure, or troubleshooting note.': 'أنشئ دليلاً أو دليل تكامل أو إجراءً أو ملاحظة لاستكشاف الأخطاء.',
    'Ready means finalized for your personal library; it is not shared with other accounts.': 'تعني «جاهز» أن العنصر مكتمل في مكتبتك الشخصية؛ ولا تتم مشاركته مع الحسابات الأخرى.',
    'Formatting uses safe Markdown-style headings, lists, code blocks, and links. Do not store passwords or secret keys here.': 'يدعم التنسيق عناوين وقوائم وكتلاً برمجية وروابط آمنة بأسلوب Markdown. لا تخزّن كلمات المرور أو المفاتيح السرية هنا.',
    'To rename the system itself, edit it in Settings → Systems — that relabels it everywhere at once.': 'لإعادة تسمية النظام، عدّله من الإعدادات ← الأنظمة، وسيتغير اسمه في كل الأماكن.',
    'Which page the app opens on next launch. "Last page" also restores that page\'s filters and — for Clients/Internal Tasks — the last-open record.': 'حدد الصفحة التي يفتحها التطبيق في التشغيل التالي. يعيد خيار «آخر صفحة» أيضاً عوامل التصفية وآخر سجل مفتوح للعملاء / المهام الداخلية.',
    'A one-page explainer of the Task → Sessions → optional Project/Department model, plus the quickest path for each everyday journey.': 'شرح من صفحة واحدة لنموذج المهمة ← الجلسات ← المشروع / القسم الاختياري، مع أسرع مسار لكل إجراء يومي.',
    'Manage account details and access. Administrators can manage every account; standard users can edit only their own profile and password.': 'إدارة تفاصيل الحسابات والوصول. يمكن للمسؤولين إدارة جميع الحسابات، بينما يمكن للمستخدم العادي تعديل ملفه وكلمة مروره فقط.',
    'Checks the live database, every rotating snapshot, referenced document files, search index, disk headroom, schema version, and credential portability. Read-only and safe to run.': 'يفحص قاعدة البيانات الحية وكل نسخة دورية وملفات المستندات المشار إليها وفهرس البحث ومساحة القرص وإصدار المخطط وقابلية نقل بيانات الدخول. الفحص للقراءة فقط وآمن.',
    'Auto-rotated snapshots taken on launch (newest 5 kept). Restoring replaces the live database and restarts the app — a safety copy of the current data is always taken first.': 'نسخ دورية تُنشأ عند التشغيل (يُحتفظ بأحدث خمس). تستبدل الاستعادة قاعدة البيانات الحية وتعيد تشغيل التطبيق، وتُنشأ دائماً نسخة أمان أولاً.',
    'Read-only — checks the database file for structural corruption and dangling foreign keys. Safe to run any time.': 'للقراءة فقط — يفحص ملف قاعدة البيانات بحثاً عن تلف بنيوي ومفاتيح خارجية غير مرتبطة. آمن للتشغيل في أي وقت.',
    'Tune the visual rhythm for your eyes and your task. These preferences stay on this device and never change your records.': 'اضبط مظهر الواجهة بما يلائم عينيك وعملك. تبقى هذه التفضيلات على هذا الجهاز ولا تغيّر سجلاتك.',
    'Temporarily hide navigation and give the active workspace the full window.': 'أخفِ التنقل مؤقتاً وامنح مساحة العمل النشطة كامل النافذة.',
    'Start any core workflow from one place. Nothing is written until you complete and save the existing form.': 'ابدأ أي إجراء أساسي من مكان واحد. لن تُكتب أي بيانات حتى تكمل النموذج وتحفظه.',
    'is one stretch of time on one date, logged against a task — a task can have many, across many days.': 'هي فترة عمل في تاريخ واحد مسجلة على مهمة؛ ويمكن للمهمة أن تحتوي جلسات عديدة عبر أيام مختلفة.',
    '— a Project (client/system work), a Department (internal work), or neither. Never both.': '— إما مشروع (عمل عميل / نظام)، أو قسم (عمل داخلي)، أو لا شيء منهما؛ وليس كليهما أبداً.',
    'Daily Work Report': 'تقرير العمل اليومي', 'Total Hours': 'إجمالي الساعات', 'Total Minutes': 'إجمالي الدقائق',
    'Work Time': 'وقت العمل', 'Description / Source': 'الوصف / المصدر', 'sessions grouped by task': 'الجلسات مجمعة حسب المهمة',
    'Min': 'دقيقة', 'Hrs': 'ساعة', 'Total': 'الإجمالي', 'Sources': 'المصادر', 'Source': 'المصدر',
    'No work recorded on this day.': 'لا يوجد عمل مسجل في هذا اليوم.', 'Printed {date}': 'طُبع في {date}',
    'Over-Time Request': 'طلب وقت إضافي', 'Total Over-Time': 'إجمالي الوقت الإضافي', 'Entries': 'الإدخالات',
    'Days': 'الأيام', 'Employee': 'الموظف', 'Approved by': 'اعتمد بواسطة',
    'No Over-Time recorded in {month}.': 'لا يوجد وقت إضافي مسجل في {month}.',
    'Kindly find below the Over-Time hours logged during {month}, submitted for your review and approval.': 'يرجى الاطلاع أدناه على ساعات الوقت الإضافي المسجلة خلال {month} والمقدمة لمراجعتكم واعتمادكم.',
    'The total Over-Time for the period is {hours} hours across {dayPhrase}.': 'إجمالي الوقت الإضافي للفترة هو {hours} ساعة موزعة على {dayPhrase}.',
    'Subscriptions Report': 'تقرير الاشتراكات', 'Renewing ≤30d': 'تتجدد خلال ≤30 يوماً', 'Overdue': 'متأخرة',
    'No subscriptions recorded.': 'لا توجد اشتراكات مسجلة.', 'Recurring Spend by Currency': 'الإنفاق المتكرر حسب العملة',
    'Monthly': 'شهري', 'Yearly': 'سنوي', 'No subscription costs recorded.': 'لا توجد تكاليف اشتراكات مسجلة.',
    'Report': 'تقرير', 'PDF saved': 'تم حفظ ملف PDF', 'Printing failed': 'فشلت الطباعة',
    'No records on that day — showing an empty report': 'لا توجد سجلات في ذلك اليوم — سيُعرض تقرير فارغ',
    'No subscriptions yet — showing an empty report': 'لا توجد اشتراكات بعد — سيُعرض تقرير فارغ',
    'Could not load subscriptions': 'تعذر تحميل الاشتراكات',
    'Analytics — {label}': 'التحليلات — {label}', 'generated {date}': 'أُنشئ في {date}',
    'Today': 'اليوم', 'in {days} days': 'خلال {days} يوم', 'Overdue by {days} days': 'متأخر منذ {days} يوم',
    'minutes': 'دقائق', 'on the selected day': 'في اليوم المحدد', 'Flat': 'مسطح',
    '— defaults to the description': '— يستخدم الوصف افتراضياً', '— Project link, Sources': '— رابط المشروع والمصادر',
    '— optional, link this task to a project': '— اختياري، اربط هذه المهمة بمشروع',
    '— optional, e.g. Jira tickets, email threads': '— اختياري، مثل تذاكر Jira ومحادثات البريد',
    '— the day this session was worked': '— اليوم الذي نُفذت فيه هذه الجلسة',
    '/30 tags. Existing tags are suggested automatically.': '/30 وسم. تُقترح الوسوم الموجودة تلقائياً.',
    '— optional': '— اختياري', 'Settings → Companies': 'الإعدادات ← الشركات',
    '— expiry, credential location, notes': '— انتهاء الصلاحية وموقع بيانات الدخول والملاحظات',
    '— secret, expiry, endpoints, notes': '— المفتاح السري والانتهاء ونقاط الاتصال والملاحظات',
    '— search and click to add': '— ابحث وانقر للإضافة', '— a project can span several': '— يمكن أن يشمل المشروع عدة أنظمة',
    'onto another task, then delete this one. Only sessions move — the target task\'s own Company/System/Status/Project fields are never changed.': 'إلى مهمة أخرى، ثم حذف هذه المهمة. تُنقل الجلسات فقط، ولا تتغير حقول الشركة أو النظام أو الحالة أو المشروع في المهمة المستهدفة.',
    'Secure credential storage (Windows DPAPI) is unavailable. Saving a client password or secret key is blocked until secure storage becomes available; existing encrypted credentials remain protected.': 'التخزين الآمن لبيانات الدخول (Windows DPAPI) غير متاح. يُمنع حفظ كلمة مرور عميل أو مفتاح سري حتى يتوفر التخزين الآمن؛ وتبقى بيانات الدخول المشفرة الحالية محمية.',
    'Captures the database, uploaded project files, company document files, Knowledge Hub documents, and the rotating backup snapshots into one new timestamped folder on your Desktop — the most complete recovery point the app can produce. Full Restore validates checksums, the database, and every referenced attachment before replacing anything, and first creates a complete safety backup of the current data. Client secrets use Windows DPAPI and remain decryptable only under the Windows account that encrypted them.': 'يجمع قاعدة البيانات وملفات المشاريع المرفوعة ومستندات الشركة ومستندات مركز المعرفة والنسخ الدورية في مجلد جديد مؤرخ على سطح المكتب، وهو أشمل نقطة استعادة يمكن للتطبيق إنشاؤها. تتحقق الاستعادة الكاملة من البصمات وقاعدة البيانات وكل مرفق مشار إليه قبل استبدال أي شيء، وتنشئ أولاً نسخة أمان كاملة للبيانات الحالية. تستخدم أسرار العملاء Windows DPAPI ولا يمكن فكها إلا بحساب Windows الذي شفّرها.',
    'The full bundle carries all ordinary data and documents. Client passwords and secret keys are protected by Windows DPAPI, so for full credential recovery restore under the same Windows account. Otherwise, plan to re-enter those secrets.': 'تحتوي الحزمة الكاملة جميع البيانات والمستندات العادية. كلمات مرور العملاء والمفاتيح السرية محمية بواسطة Windows DPAPI؛ لذا استعدها تحت حساب Windows نفسه لاستعادة بيانات الدخول كاملة، وإلا فستحتاج إلى إعادة إدخالها.',
    'Case-insensitive label collisions (e.g. "Acme" / "ACME") within Companies, Systems, or Natural — the same class of duplicate a past migration cleaned up once already. Merging moves every reference onto the kept code and removes the duplicate.': 'تعارضات الأسماء دون اعتبار حالة الأحرف (مثل Acme وACME) داخل الشركات أو الأنظمة أو طبيعة العمل. ينقل الدمج كل المراجع إلى الرمز المحتفظ به ويزيل التكرار.',
    'Runs automatically on every launch — removes leftover file folders for projects/documents that no longer exist. Shown below is what the most recent launch found.': 'يعمل تلقائياً عند كل تشغيل، ويزيل مجلدات الملفات المتبقية للمشاريع أو المستندات التي لم تعد موجودة. تظهر أدناه نتيجة آخر تشغيل.',
    'Focus shortcut: Ctrl + Shift + F': 'اختصار التركيز: Ctrl + Shift + F',
    'Shortcut: Ctrl + Shift + N': 'الاختصار: Ctrl + Shift + N',
    'navigate': 'تنقل', 'Enter': 'إدخال', 'select': 'تحديد', 'close': 'إغلاق',
    'Type a date like 2026-07-01': 'اكتب تاريخاً مثل 2026-07-01',
    'Add new (Timesheet record, Subscription, Project, Company Document — context-dependent)': 'إضافة جديد (سجل دوام أو اشتراك أو مشروع أو مستند شركة، حسب السياق)',
    'is the durable thing — its name, company/system, and status.': 'هي العمل الدائم بحد ذاته: اسمه وشركته / نظامه وحالته.',
    'Click its chip in the': 'انقر على شريحته في قسم',
    'strip at the top of Timesheet → fill in Time Type, Natural, Minutes → Save.': 'أعلى سجل الدوام ← أدخل نوع الوقت وطبيعة العمل والدقائق ← حفظ.',
    '→ Company, System, Status, Description → Save. Project link and Sources are optional — tucked under': '← الشركة والنظام والحالة والوصف ← حفظ. رابط المشروع والمصادر اختياريان وموجودان ضمن',
    'Click the': 'انقر زر',
    'button on its row or card — no dropdown, no modal. Sets it Done immediately (undoable).': 'في صفه أو بطاقته، دون قائمة أو نافذة. سيُضبط كمكتمل فوراً مع إمكانية التراجع.'
  };

  // Secondary UI copy: tooltips, placeholders, empty states, validation and
  // operation feedback. Record and catalog values remain excluded below.
  Object.assign(ar, {
    'COOPERATION': 'التعاون', 'TOOLS': 'أدوات', 'PDF': 'PDF', 'June 2026': 'يونيو ٢٠٢٦',
    '• List': '• قائمة', '1. List': '1. قائمة',
    'Collapse navigation': 'طي شريط التنقل', 'Quick Find (Ctrl+K)': 'البحث السريع (Ctrl+K)',
    'Create new (Ctrl+Shift+N)': 'إنشاء جديد (Ctrl+Shift+N)', 'Today — Timesheet': 'اليوم — سجل الدوام',
    'Workspace view and eye comfort': 'عرض مساحة العمل وراحة العين', 'Switch between light and dark mode': 'التبديل بين الوضع الفاتح والداكن',
    'Back up your data — a full backup or just the database': 'نسخ بياناتك احتياطياً — نسخة كاملة أو قاعدة البيانات فقط',
    'Log out of this session': 'تسجيل الخروج من هذه الجلسة', 'Application version': 'إصدار التطبيق',
    'Save this analytics view as PDF': 'حفظ عرض التحليلات بصيغة PDF', 'Start a workflow': 'بدء إجراء',
    'Pause / resume': 'إيقاف مؤقت / استئناف', 'Month overview': 'نظرة عامة على الشهر',
    'Prefill a new session from the latest session shown': 'تعبئة جلسة جديدة من آخر جلسة ظاهرة',
    'Your name': 'اسمك', 'Filter rows…': 'تصفية الصفوف…', 'Clear filter': 'مسح عامل التصفية',
    'How the day\'s sessions are laid out': 'طريقة عرض جلسات اليوم', 'Quick duration': 'مدة سريعة',
    'What did you do?': 'ماذا أنجزت؟', 'Search subscriptions…': 'البحث في الاشتراكات…',
    'Search companies…': 'البحث في الشركات…', 'Search systems…': 'البحث في الأنظمة…',
    'Task workspace': 'مساحة عمل المهام', 'Search departments…': 'البحث في الأقسام…',
    'Search titles, content, documents, or tags…': 'البحث في العناوين أو المحتوى أو المستندات أو الوسوم…',
    'Active filters': 'عوامل التصفية النشطة', 'A clear, searchable title': 'عنوان واضح وقابل للبحث',
    'What this item helps someone understand or do': 'ما الذي يساعد هذا العنصر على فهمه أو تنفيذه',
    'Formatting tools': 'أدوات التنسيق', 'Heading': 'عنوان', 'Bulleted list': 'قائمة نقطية',
    'Numbered list': 'قائمة مرقمة', 'Code block': 'كتلة برمجية',
    'Write prerequisites, steps, notes, and troubleshooting guidance…': 'اكتب المتطلبات والخطوات والملاحظات وإرشادات استكشاف الأخطاء…',
    'Add a tag and press Enter': 'أضف وسماً واضغط Enter', 'Filter groups…': 'تصفية المجموعات…',
    'What belongs in this group': 'ما الذي ينتمي إلى هذه المجموعة', 'Filter knowledge items…': 'تصفية عناصر المعرفة…',
    'Search documents…': 'البحث في المستندات…', 'Anything worth remembering about this document': 'أي ملاحظات مهمة حول هذا المستند',
    'Search all client records… e.g. “VPN” or “Amana Visa”': 'البحث في جميع سجلات العميل… مثل “VPN” أو “Amana Visa”',
    'VPN login password': 'كلمة مرور اتصال VPN', 'Reference notes only': 'ملاحظات مرجعية فقط',
    'Login password': 'كلمة مرور الدخول', 'Anything worth remembering about this server': 'أي ملاحظات مهمة حول هذا الخادم',
    'Integration secret key': 'المفتاح السري للتكامل', 'What is this engagement about?': 'ما موضوع هذا المشروع؟',
    'Search tasks…': 'البحث في المهام…', 'Find a setting…': 'البحث عن إعداد…', 'What needs to be done?': 'ما المطلوب إنجازه؟',
    'Workspace density': 'كثافة مساحة العمل', 'Workspace canvas': 'خلفية مساحة العمل', 'Workspace motion': 'حركة مساحة العمل',
    'Exit Focus Mode (Ctrl+Shift+F)': 'إنهاء وضع التركيز (Ctrl+Shift+F)',
    'Jump to a page, task, project or date…': 'انتقل إلى صفحة أو مهمة أو مشروع أو تاريخ…',
    'Search pages, actions, and workspace data': 'البحث في الصفحات والإجراءات وبيانات مساحة العمل',
    'e.g. Q3 billing integration': 'مثال: تكامل فواتير الربع الثالث', 'e.g. 45': 'مثال: 45',
    'e.g. Employee Onboarding': 'مثال: تهيئة الموظفين الجدد', 'e.g. Installation Manual': 'مثال: دليل التثبيت',
    'e.g. 1.0, 2026.07, Rev B': 'مثال: 1.0 أو 2026.07 أو Rev B', 'e.g. VAT Certificate': 'مثال: شهادة ضريبة القيمة المضافة',
    'e.g. HQ Site-to-Site': 'مثال: اتصال المقر الرئيسي', 'e.g. VPN, PAM, WireGuard, IPSec': 'مثال: VPN أو PAM أو WireGuard أو IPSec',
    'e.g. vpn.client.com': 'مثال: vpn.client.com', 'e.g. 65000': 'مثال: 65000', 'e.g. jane.doe': 'مثال: jane.doe',
    'e.g. Bitwarden — IT-Ops vault': 'مثال: Bitwarden — خزنة عمليات تقنية المعلومات', 'e.g. 10.0.0.5': 'مثال: 10.0.0.5',
    'e.g. ACME-Rabbit': 'مثال: ACME-Rabbit', 'e.g. Ubuntu Server': 'مثال: Ubuntu Server', 'e.g. admin': 'مثال: admin',
    'e.g. RabbitMQ Portal - Production': 'مثال: بوابة RabbitMQ - الإنتاج',
    'e.g. RabbitMQ — groups with a matching server': 'مثال: RabbitMQ — يُجمع مع خادم مطابق',
    'e.g. http://10.0.0.20:15672/': 'مثال: http://10.0.0.20:15672/', 'e.g. 105': 'مثال: 105',
    'e.g. Message queue admin console': 'مثال: لوحة إدارة قائمة الرسائل', 'e.g. Travel Cover': 'مثال: تغطية السفر',
    'e.g. Acme Payroll Rollout': 'مثال: إطلاق نظام الرواتب', 'e.g. Adobe Creative Cloud': 'مثال: Adobe Creative Cloud', 'e.g. 49.99': 'مثال: 49.99',

    'Close dialog': 'إغلاق النافذة', 'All types': 'كل الأنواع', 'Open this day in the Timesheet': 'فتح هذا اليوم في سجل الدوام',
    'Click to rename this task': 'انقر لإعادة تسمية المهمة', 'Click to change status': 'انقر لتغيير الحالة',
    'Click to edit minutes': 'انقر لتعديل الدقائق', 'Click to copy': 'انقر للنسخ', 'Mark done': 'تحديد كمكتمل',
    'View task details': 'عرض تفاصيل المهمة', 'Log another session on this task': 'تسجيل جلسة أخرى على هذه المهمة',
    'Add another session to this task': 'إضافة جلسة أخرى إلى هذه المهمة', 'Log a new session against this task': 'تسجيل جلسة جديدة على هذه المهمة',
    'Start timer': 'بدء المؤقت', 'Stop timer': 'إيقاف المؤقت', 'Pause': 'إيقاف مؤقت', 'Resume': 'استئناف',
    'Move to another day': 'نقل إلى يوم آخر', 'Move record to this day': 'نقل السجل إلى هذا اليوم',
    'Duplicate as a new task': 'تكرار كمهمة جديدة', 'Yes': 'نعم', 'No': 'لا', '— select —': '— اختر —',
    'No department': 'بلا قسم', 'Select type…': 'اختر النوع…', 'Remove source': 'إزالة المصدر',
    'Show/hide password': 'إظهار/إخفاء كلمة المرور', 'Show/hide secret key': 'إظهار/إخفاء المفتاح السري',
    'View history': 'عرض السجل', 'More actions': 'إجراءات إضافية', 'Edit selected group': 'تعديل المجموعة المحددة',
    'Create a new task already linked to this project': 'إنشاء مهمة جديدة مرتبطة بهذا المشروع',
    'Create a new task already linked to this department': 'إنشاء مهمة جديدة مرتبطة بهذا القسم',
    'Edit session': 'تعديل الجلسة', 'Delete session': 'حذف الجلسة', 'Edit task': 'تعديل المهمة', 'Delete task': 'حذف المهمة',
    'Group existing servers under a new (or existing) System name': 'تجميع الخوادم الموجودة تحت اسم نظام جديد أو موجود',
    'Group existing internal systems under a new (or existing) System name': 'تجميع الأنظمة الداخلية الموجودة تحت اسم نظام جديد أو موجود',
    'All three identify the server and must be unique for this client.': 'تُعرّف الحقول الثلاثة الخادم ويجب أن تكون فريدة لهذا العميل.',
    'Label (e.g. Bookings)': 'التسمية (مثال: Bookings)',

    'Could not load data — some views may be empty': 'تعذر تحميل البيانات — قد تكون بعض العروض فارغة',
    'Could not save — your changes are still on screen. Retrying on next edit.': 'تعذر الحفظ — ما زالت تغييراتك ظاهرة وستتم إعادة المحاولة عند التعديل التالي.',
    'Saving…': 'جارٍ الحفظ…', 'Not saved': 'لم يتم الحفظ', 'Saved': 'تم الحفظ',
    'Saved — reopen the app to refresh': 'تم الحفظ — أعد فتح التطبيق للتحديث',
    'Settings saved; reopen the app to refresh catalogs': 'تم حفظ الإعدادات؛ أعد فتح التطبيق لتحديث الكتالوجات',
    'Backing up…': 'جارٍ النسخ الاحتياطي…', 'Validating…': 'جارٍ التحقق…', 'Creating safety backup…': 'جارٍ إنشاء نسخة أمان…',
    'Restore Everything Now': 'استعادة كل شيء الآن', 'Restoring all data and restarting…': 'جارٍ استعادة جميع البيانات وإعادة التشغيل…',
    'Restoring…': 'جارٍ الاستعادة…', 'Restore Now': 'استعادة الآن', 'Restore failed': 'فشلت الاستعادة',
    'Restoring and restarting…': 'جارٍ الاستعادة وإعادة التشغيل…', 'Merge…': 'دمج…', 'Merging…': 'جارٍ الدمج…',
    'Merge Now': 'دمج الآن', 'Merge failed': 'فشل الدمج', 'Merged': 'تم الدمج',
    'Merge not supported for this category': 'الدمج غير مدعوم لهذه الفئة', 'Username is required.': 'اسم المستخدم مطلوب.',
    'A temporary password is required.': 'كلمة مرور مؤقتة مطلوبة.', 'Searching your workspace…': 'جارٍ البحث في مساحة العمل…',
    'Workspace search unavailable': 'بحث مساحة العمل غير متاح', 'Client not found': 'لم يتم العثور على العميل',
    'Task not found': 'لم يتم العثور على المهمة', 'Project not found': 'لم يتم العثور على المشروع',
    'Loading knowledge item…': 'جارٍ تحميل عنصر المعرفة…', 'Select at least one record to include': 'اختر سجلاً واحداً على الأقل لتضمينه',
    'No saved session is available to repeat on this day': 'لا توجد جلسة محفوظة متاحة للتكرار في هذا اليوم',
    'No records match your search': 'لا توجد سجلات تطابق بحثك', 'No documents match your search': 'لا توجد مستندات تطابق بحثك',
    'No file uploaded': 'لم يتم رفع ملف', 'File missing from disk': 'الملف مفقود من القرص', 'Not uploaded': 'غير مرفوع',
    'No auth connections match your search.': 'لا توجد اتصالات مصادقة تطابق بحثك.', 'No auth connections recorded yet.': 'لم تُسجل اتصالات مصادقة بعد.',
    'No internal systems match your search.': 'لا توجد أنظمة داخلية تطابق بحثك.', 'No internal systems recorded yet.': 'لم تُسجل أنظمة داخلية بعد.',
    'No projects for this client yet.': 'لا توجد مشاريع لهذا العميل بعد.', 'No projects match your search.': 'لا توجد مشاريع تطابق بحثك.',
    'No servers match your search.': 'لا توجد خوادم تطابق بحثك.', 'No servers recorded yet.': 'لم تُسجل خوادم بعد.',
    'No documents yet — add the first versioned file.': 'لا توجد مستندات بعد — أضف أول ملف ذي إصدار.',
    'No groups or tags yet.': 'لا توجد مجموعات أو وسوم بعد.', 'No sources added yet.': 'لم تُضف مصادر بعد.',
    'No sessions yet': 'لا توجد جلسات بعد', 'No sessions yet — this task hasn\'t been worked on.': 'لا توجد جلسات بعد — لم يبدأ العمل على هذه المهمة.',
    'No sessions logged on this project yet.': 'لم تُسجل جلسات على هذا المشروع بعد.',
    'No tasks linked yet — use “Link Task” to attach existing work.': 'لا توجد مهام مرتبطة بعد — استخدم «ربط مهمة» لإرفاق عمل موجود.',
    'No unlinked tasks available.': 'لا توجد مهام غير مرتبطة متاحة.',
    'No document types configured — add them in Settings → Project Documents.': 'لم تُضبط أنواع مستندات — أضفها من الإعدادات ← مستندات المشروع.',
    'Create knowledge items first, or create an empty group now.': 'أنشئ عناصر معرفة أولاً، أو أنشئ مجموعة فارغة الآن.',
    'Your formatted preview will appear here.': 'ستظهر المعاينة المنسقة هنا.',
    'Use the tabs above to manage this client’s projects, access records, servers, and internal systems. Search spans every tab without searching passwords or secret keys.': 'استخدم علامات التبويب أعلاه لإدارة مشاريع العميل وسجلات الوصول والخوادم والأنظمة الداخلية. يشمل البحث كل التبويبات دون كلمات المرور أو المفاتيح السرية.',
    'Attachment saved': 'تم حفظ المرفق', 'Document added': 'تمت إضافة المستند', 'Document created': 'تم إنشاء المستند',
    'Document saved': 'تم حفظ المستند', 'Document removed': 'تمت إزالة المستند', 'Document restored': 'تمت استعادة المستند',
    'File saved': 'تم حفظ الملف', 'File replaced': 'تم استبدال الملف', 'File removed': 'تمت إزالة الملف',
    'Project created': 'تم إنشاء المشروع', 'Project saved': 'تم حفظ المشروع', 'Session added': 'تمت إضافة الجلسة',
    'Sources updated': 'تم تحديث المصادر', 'Task linked': 'تم ربط المهمة', 'Task unlinked': 'تم إلغاء ربط المهمة',
    'Task merged': 'تم دمج المهمة', 'Merge undone': 'تم التراجع عن الدمج', 'Task and session restored': 'تمت استعادة المهمة والجلسة',
    'Group created': 'تم إنشاء المجموعة', 'Group deleted': 'تم حذف المجموعة', 'Group restored': 'تمت استعادة المجموعة',
    'VPN connection saved': 'تم حفظ اتصال VPN', 'Server saved': 'تم حفظ الخادم', 'Internal system saved': 'تم حفظ النظام الداخلي',
    'Unsaved draft recovered': 'تمت استعادة المسودة غير المحفوظة',
    'Draft copy created with the same tags and groups': 'تم إنشاء نسخة مسودة بالوسوم والمجموعات نفسها',
    'Knowledge item restored': 'تمت استعادة عنصر المعرفة', 'Organization': 'التنظيم', 'Written guidance': 'إرشادات مكتوبة',
    'Sub-Services': 'الخدمات الفرعية', 'Save Sources': 'حفظ المصادر', 'Add new…': 'إضافة جديد…', '+ Add': '+ إضافة',
    'Filter groups or tags…': 'تصفية المجموعات أو الوسوم…', 'Merge into another task…': 'الدمج في مهمة أخرى…',
    'Remove': 'إزالة', 'Restore…': 'استعادة…', 'Saving… try again in a moment': 'جارٍ الحفظ… حاول مجدداً بعد لحظة',
    '— No category —': '— بلا فئة —', '← Knowledge Hub': 'مركز المعرفة →'
  });

  const uiNounsAr = {
    clients: 'العملاء', 'company documents': 'مستندات الشركة', department: 'القسم', departments: 'الأقسام',
    'Knowledge Hub': 'مركز المعرفة', 'knowledge item': 'عنصر المعرفة', projects: 'المشاريع', records: 'السجلات',
    task: 'المهمة', tasks: 'المهام', document: 'المستند', file: 'الملف', group: 'المجموعة',
    'internal system': 'النظام الداخلي', item: 'العنصر', project: 'المشروع', server: 'الخادم',
    session: 'الجلسة', settings: 'الإعدادات', sources: 'المصادر', subscriptions: 'الاشتراكات',
    'the record': 'السجل', 'the session': 'الجلسة', 'the task': 'المهمة', 'VPN connection': 'اتصال VPN'
  };
  const dynamicArabicRules = [
    [/^Could not (load|save|delete|restore|open|remove|download|upload|create|add|update|link|unlink|merge|copy|mark|undo|duplicate) (.+)$/s, m => {
      const verbs = { load: 'تحميل', save: 'حفظ', delete: 'حذف', restore: 'استعادة', open: 'فتح', remove: 'إزالة', download: 'تنزيل', upload: 'رفع', create: 'إنشاء', add: 'إضافة', update: 'تحديث', link: 'ربط', unlink: 'إلغاء ربط', merge: 'دمج', copy: 'نسخ', mark: 'تحديد', undo: 'التراجع عن', duplicate: 'تكرار' };
      return `تعذر ${verbs[m[1]]} ${uiNounsAr[m[2]] || m[2]}`;
    }],
    [/^History — (.+)$/s, m => `السجل — ${m[1]}`], [/^Browse all work for (.+)$/s, m => `تصفح كل العمل الخاص بـ ${m[1]}`],
    [/^Open project: (.+)$/s, m => `فتح المشروع: ${m[1]}`], [/^Open department: (.+)$/s, m => `فتح القسم: ${m[1]}`],
    [/^Open (.+)$/s, m => `فتح ${m[1]}`], [/^Remove filter (.+)$/s, m => `إزالة عامل التصفية ${m[1]}`],
    [/^Remove tag (.+)$/s, m => `إزالة الوسم ${m[1]}`], [/^Moved to (.+)$/s, m => `تم النقل إلى ${m[1]}`],
    [/^Session logged to (.+)$/s, m => `تم تسجيل الجلسة في ${m[1]}`], [/^Role: (.+)$/s, m => `الدور: ${m[1]}`],
    [/^Credential location: (.+)$/s, m => `موقع بيانات الدخول: ${m[1]}`], [/^Type "(.+)" to confirm$/s, m => `اكتب "${m[1]}" للتأكيد`],
    [/^Tasks \((.+)\)$/s, m => `المهام (${m[1].replace(' of ', ' من ')})`], [/^Sessions \((.+)\)$/s, m => `الجلسات (${m[1]})`],
    [/^Documents \((.+)\)$/s, m => `المستندات (${m[1]})`], [/^PDF failed: (.+)$/s, m => `فشل PDF: ${m[1]}`],
    [/^(\d+) documents?$/s, m => `${m[1]} مستند`], [/^Updated today$/s, () => 'تم التحديث اليوم'],
    [/^Updated yesterday$/s, () => 'تم التحديث أمس'], [/^Updated (\d+) days? ago$/s, m => `تم التحديث منذ ${m[1]} يوم`],
    [/^Updated (\d+) weeks? ago$/s, m => `تم التحديث منذ ${m[1]} أسبوع`], [/^Updated (.+)$/s, m => `تم التحديث ${m[1]}`],
    [/^Overdue — (.+)$/s, m => `متأخر — ${m[1]}`], [/^Renews soon — (.+)$/s, m => `يتجدد قريباً — ${m[1]}`],
    [/^Renews (.+)$/s, m => `يتجدد ${m[1]}`], [/^Expires soon — (.+)$/s, m => `تنتهي الصلاحية قريباً — ${m[1]}`],
    [/^Expires (.+)$/s, m => `تنتهي الصلاحية ${m[1]}`], [/^in “(.+)”$/s, m => `ضمن «${m[1]}»`],
    [/^Full backup failed: (.+)$/s, m => `فشل النسخ الاحتياطي الكامل: ${m[1]}`],
    [/^Full restore stopped: (.+)$/s, m => `توقفت الاستعادة الكاملة: ${m[1]}`]
  ];

  let language = readLanguage();
  let loginLanguageChoice = null;
  const translatedTextNodes = new Set();
  const translatedElements = new Set();
  const originals = new WeakMap();
  const attrOriginals = new WeakMap();
  let observer;
  let initialScan = false;

  function readLanguage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (SUPPORTED.has(saved)) return saved;
    } catch (_) {}
    return 'en';
  }

  function arabicTranslation(key) {
    if (ar[key]) return ar[key];
    for (const [pattern, format] of dynamicArabicRules) {
      const match = String(key).match(pattern);
      if (match) return format(match);
    }
    return key;
  }

  function t(key, vars) {
    let value = language === 'ar' ? arabicTranslation(key) : key;
    if (vars) Object.keys(vars).forEach(name => { value = value.replaceAll('{' + name + '}', String(vars[name])); });
    return value;
  }

  function isUiTextNode(node) {
    const el = node.parentElement;
    if (!el || el.closest('script,style,[data-i18n-ignore]')) return false;
    if (el.closest('input,textarea,[contenteditable="true"]')) return false;
    // Fixed options present in index.html are captured during the initial scan;
    // options created later are lookup/catalog values owned by the user.
    if (!initialScan && el.closest('option')) return false;
    // Values inside these containers are records or user-managed lookup names.
    if (el.closest([
      '[data-user-content]', '.knowledge-content-rendered', '.md-preview', '.task-source-ref',
      '.desc-text', '.source-link', '.sidebar-username', '#td-title', '#merge-source-name',
      '#client-record-info-title', '[id$="-record-name"]', '[id$="-item-name"]',
      '[class*="task-name"]', '[class*="client-name"]', '[class*="project-name"]',
      '[class*="document-name"]', '[class*="knowledge-title"]', '[class*="record-title"]'
    ].join(','))) return false;
    return true;
  }

  function translatedValue(value) {
    const match = String(value).match(/^(\s*)(.*?)(\s*)$/s);
    if (!match || !match[2]) return value;
    const result = t(match[2]);
    return result === match[2] ? value : match[1] + result + match[3];
  }

  function translateTextNode(node) {
    if (!isUiTextNode(node)) return;
    if (!originals.has(node)) {
      const source = String(node.nodeValue).trim();
      if (arabicTranslation(source) === source) return;
      originals.set(node, node.nodeValue);
      translatedTextNodes.add(node);
    }
    node.nodeValue = language === 'ar' ? translatedValue(originals.get(node)) : originals.get(node);
  }

  function translateAttributes(el) {
    if (!(el instanceof Element) || el.closest('[data-i18n-ignore]')) return;
    const attrs = ['title', 'placeholder', 'aria-label'];
    let saved = attrOriginals.get(el);
    attrs.forEach(attr => {
      if (!el.hasAttribute(attr)) return;
      const current = el.getAttribute(attr);
      const translatedCurrent = arabicTranslation(current);
      if (!saved && translatedCurrent !== current) saved = {};
      if (!saved) return;
      if (saved[attr]) {
        const oldSource = saved[attr];
        const oldTranslated = arabicTranslation(oldSource);
        if (current !== oldSource && current !== oldTranslated && translatedCurrent !== current) saved[attr] = current;
      } else {
        if (translatedCurrent === current) return;
        saved[attr] = current;
      }
      const desired = language === 'ar' ? t(saved[attr]) : saved[attr];
      if (current !== desired) el.setAttribute(attr, desired);
    });
    if (saved) { attrOriginals.set(el, saved); translatedElements.add(el); }
  }

  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) { translateTextNode(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node); else translateAttributes(node);
    }
  }

  function refreshLanguageControls() {
    document.querySelectorAll('[data-language]').forEach(btn => {
      const active = btn.dataset.language === language;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const toggle = document.getElementById('language-toggle');
    const label = document.getElementById('language-toggle-label');
    if (toggle) toggle.title = language === 'ar' ? 'التبديل إلى الإنجليزية' : 'Switch to Arabic';
    if (label) label.textContent = language === 'ar' ? 'English' : 'العربية';
  }

  function applyDocumentLanguage() {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.language = language;
    if (document.body) document.body.classList.toggle('rtl', language === 'ar');
  }

  function setLanguage(next, options) {
    if (!SUPPORTED.has(next)) return;
    language = next;
    if (!options || options.persist !== false) {
      try { localStorage.setItem(STORAGE_KEY, language); } catch (_) {}
    }
    applyDocumentLanguage();
    translatedTextNodes.forEach(node => { if (node.isConnected) translateTextNode(node); });
    translatedElements.forEach(el => { if (el.isConnected) translateAttributes(el); });
    translateTree(document.body);
    refreshLanguageControls();
    document.dispatchEvent(new CustomEvent('ct:languagechange', { detail: { language } }));
  }

  function init() {
    applyDocumentLanguage();
    initialScan = true;
    translateTree(document.body);
    initialScan = false;
    refreshLanguageControls();
    observer = new MutationObserver(records => {
      observer.disconnect();
      records.forEach(record => {
        record.addedNodes.forEach(translateTree);
        if (record.type === 'characterData') translateTextNode(record.target);
        if (record.type === 'attributes') translateAttributes(record.target);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['title', 'placeholder', 'aria-label'] });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['title', 'placeholder', 'aria-label'] });
  }

  window.ctI18n = {
    t, setLanguage, getLanguage: () => language,
    getLoginLanguageChoice: () => loginLanguageChoice,
    translateTree
  };
  window.setAppLanguage = function (next) {
    setLanguage(next);
    if (typeof uiState !== 'undefined') {
      uiState.language = next;
      if (typeof saveUiStateDebounced === 'function') saveUiStateDebounced();
    }
  };
  window.toggleAppLanguage = function () {
    window.setAppLanguage(language === 'ar' ? 'en' : 'ar');
  };
  window.chooseLoginLanguage = function (next) {
    loginLanguageChoice = next;
    setLanguage(next);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
