/* Office ONE localization.
 *
 * English remains the source language used by the existing renderer. This
 * small runtime translates UI-only strings and observes feature renderers so
 * newly opened modals/cards are localized too. Records and input values are
 * not modified; managed catalog labels are selected from their stored English
 * and Arabic names by the renderer's lookup helpers.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'ct-language';
  const SUPPORTED = new Set(['en', 'ar']);
  const ar = {
    // The product name is a Latin brand shown identically in both languages;
    // the self-mapping keeps it out of the untranslated-string coverage gate.
    'Office ONE': 'Office ONE', 'Choose language': 'اختر اللغة',
    'Welcome back': 'مرحباً بعودتك', 'Log in to continue': 'سجّل الدخول للمتابعة',
    'Create your account': 'أنشئ حسابك', 'This is the first account on this device': 'هذا أول حساب على هذا الجهاز',
    'Username': 'اسم المستخدم', 'Password': 'كلمة المرور', 'Confirm password': 'تأكيد كلمة المرور',
    'Log in': 'تسجيل الدخول', 'Create account': 'إنشاء حساب', 'Passwords do not match.': 'كلمتا المرور غير متطابقتين.',
    'Choose a new password': 'اختر كلمة مرور جديدة',
    'Your password was set by an administrator. Choose a new one to continue.': 'كلمة المرور الخاصة بك حدّدها المسؤول. اختر كلمة مرور جديدة للمتابعة.',
    'Change password': 'تغيير كلمة المرور', 'New password': 'كلمة المرور الجديدة',
    'Could not change password.': 'تعذّر تغيير كلمة المرور.', 'Must change password': 'يجب تغيير كلمة المرور',
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
    'By Task': 'حسب المهمة', 'By Activity': 'حسب النشاط', 'More Breakdowns': 'تفاصيل إضافية',
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
    'Task History': 'سجل المهمة', 'View task history': 'عرض سجل المهمة',
    'Task Type': 'نوع المهمة', 'All Tasks': 'كل المهام', 'Internal': 'داخلي', 'Sources': 'المصادر',
    '+ Add Source': '+ إضافة مصدر', 'More options': 'خيارات إضافية', 'Advanced details': 'تفاصيل متقدمة',
    'Session Details': 'تفاصيل الجلسة', 'New Session Details': 'تفاصيل الجلسة الجديدة', 'Edit Session': 'تعديل الجلسة',
    'Sessions': 'الجلسات', 'Log Work': 'تسجيل عمل', 'Log work': 'تسجيل عمل', 'Save': 'حفظ',
    'Save Changes': 'حفظ التغييرات', 'Cancel': 'إلغاء', 'Close': 'إغلاق', 'Delete': 'حذف',
    'Edit': 'تعديل', 'Undo': 'تراجع', 'Discard': 'تجاهل', 'Reset': 'إعادة ضبط', 'Preview': 'معاينة',
    'Print': 'طباعة', 'Save PDF': 'حفظ PDF', 'Save CSV': 'حفظ CSV', 'CSV saved': 'تم حفظ ملف CSV',
    'CSV failed: ': 'فشل حفظ CSV: ', 'This report has no table data to export': 'لا يحتوي هذا التقرير على بيانات جدول للتصدير',
    'Generate →': 'إنشاء ←', 'Clear filters': 'مسح عوامل التصفية',
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
    'English Label': 'التسمية بالإنجليزية', 'Arabic Label': 'التسمية بالعربية', 'Add Entry': 'إضافة قيمة',
    'Enter both English and Arabic labels. The app displays the matching label for the selected interface language.': 'أدخل التسمية بالإنجليزية والعربية. يعرض التطبيق التسمية المطابقة للغة الواجهة المحددة.',
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
    'Choose the interface language. Arabic uses a right-to-left layout; your records stay unchanged and managed catalogs use their saved English or Arabic labels.': 'اختر لغة الواجهة. تستخدم العربية تخطيطاً من اليمين إلى اليسار؛ وتبقى سجلاتك دون تغيير بينما تستخدم الكتالوجات التسمية الإنجليزية أو العربية المحفوظة.',
    'Start on': 'البدء عند', 'Last page': 'آخر صفحة', 'Analytics': 'التحليلات',
    'User Management': 'إدارة المستخدمين', 'Add User': 'إضافة مستخدم', 'Edit User': 'تعديل المستخدم',
    'Permissions': 'الصلاحيات', 'Account status': 'حالة الحساب', 'Active — can sign in': 'نشط — يمكنه تسجيل الدخول',
    'Current password': 'كلمة المرور الحالية', 'New password': 'كلمة المرور الجديدة', 'Save User': 'حفظ المستخدم',
    'Display name (English)': 'الاسم المعروض (إنجليزي)', 'Display name (Arabic)': 'الاسم المعروض (عربي)',
    'Shown as your greeting name in the app, in whichever language is active — falls back to your username if left blank.':
      'يُعرض كاسم الترحيب بك في التطبيق، بأي لغة كانت نشطة — ويعود إلى اسم المستخدم إذا تُرك فارغاً.',
    'e.g. Moustafa Baraka': 'مثال: Moustafa Baraka',
    'Standard User': 'مستخدم عادي', 'Administrator': 'مسؤول',
    'Standard User — own data and preferences': 'مستخدم عادي — بياناته وتفضيلاته فقط',
    'Administrator — full settings, backup and user access': 'مسؤول — وصول كامل إلى الإعدادات والنسخ الاحتياطي والمستخدمين',
    'Companies': 'الشركات', 'Company Doc Categories': 'فئات مستندات الشركة', 'Knowledge Types': 'أنواع المعرفة',
    'Task Source Types': 'أنواع مصادر المهام', 'Server Roles': 'أدوار الخوادم', 'Maintenance': 'الصيانة',
    'Save Catalog Changes': 'حفظ تغييرات الكتالوج', 'Discard Changes': 'تجاهل التغييرات',
    'Changes discarded': 'تم تجاهل التغييرات',
    'Discard your unsaved catalog changes?': 'هل تريد تجاهل تغييرات الكتالوج غير المحفوظة؟',
    'You have unsaved Settings catalog changes that will be lost. Continue anyway?':
      'لديك تغييرات غير محفوظة في كتالوج الإعدادات ستُفقد. هل تريد المتابعة؟',
    'Full Backup': 'نسخة احتياطية كاملة',
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
    'Something went wrong — your last action may not have saved.': 'حدث خطأ ما — ربما لم يتم حفظ آخر إجراء قمت به.',
    'Signed in as {username}, {role}': 'تم تسجيل الدخول باسم {username}، {role}',
    'Show fewer': 'عرض أقل', 'Show all {n}': 'عرض الكل ({n})',
    'Full backup saved to {path}': 'تم حفظ النسخة الاحتياطية الكاملة في {path}', 'Open folder': 'فتح المجلد',
    'No records match the current filters': 'لا توجد سجلات مطابقة للمرشحات الحالية',
    'No records for this {noun}': 'لا توجد سجلات لهذا {noun}',
    'worked {date}': 'تم العمل في {date}', '{n} session': '{n} جلسة', '{n} sessions': '{n} جلسات',
    'Created {date}': 'تم الإنشاء في {date}', 'Active': 'نشط', 'Inactive': 'غير نشط',
    'Skip to main content': 'تخطي إلى المحتوى الرئيسي',
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
    'Do not store passwords or secret keys here.': 'لا تخزّن كلمات المرور أو المفاتيح السرية هنا.',
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
    'OFFICE': 'OFFICE', 'ONE': 'ONE', 'PDF': 'PDF', 'June 2026': 'يونيو ٢٠٢٦',
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

  // Dashboard, analytics, and dropdown labels generated at runtime by the
  // feature renderers. The observer translates the resulting text nodes and
  // <option> elements against these keys.
  Object.assign(ar, {
    'Avg / Day': 'المعدل / يوم', 'Completion': 'نسبة الإنجاز', 'Total Hours': 'إجمالي الساعات',
    'All clear — nothing due in the next 30 days.': 'كل شيء على ما يرام — لا يوجد استحقاق خلال 30 يوماً.',
    'no previous activity': 'لا يوجد نشاط سابق', 'No active days': 'لا توجد أيام نشطة',
    'No over-time hours in this period.': 'لا توجد ساعات إضافية في هذه الفترة.',
    'No tracked time in this period.': 'لا يوجد وقت مُسجَّل في هذه الفترة.',
    'View active-day data': 'عرض بيانات الأيام النشطة', 'No tasks yet.': 'لا توجد مهام بعد.',
    'All': 'الكل', 'Project tasks': 'مهام المشاريع', 'Unassigned': 'غير مُعيَّنة',
    'All companies': 'كل الشركات', 'All systems': 'كل الأنظمة', 'All projects': 'كل المشاريع',
    'All departments': 'كل الأقسام', 'All knowledge': 'كل المعرفة',
    'Unlinked': 'غير مرتبط', 'No department': 'بلا قسم', 'No type': 'بلا نوع',
    'Full backup to Desktop': 'نسخة احتياطية كاملة إلى سطح المكتب', 'Database only…': 'قاعدة البيانات فقط…',
    'Jan': 'يناير', 'Feb': 'فبراير', 'Mar': 'مارس', 'Apr': 'أبريل', 'May': 'مايو', 'Jun': 'يونيو',
    'Jul': 'يوليو', 'Aug': 'أغسطس', 'Sep': 'سبتمبر', 'Oct': 'أكتوبر', 'Nov': 'نوفمبر', 'Dec': 'ديسمبر',
    'No knowledge yet': 'لا توجد معرفة بعد', 'No search results': 'لا توجد نتائج بحث',
    'Nothing in this view': 'لا يوجد شيء في هذا العرض',
    'Try fewer words, a document version, or a different tag.': 'جرّب كلمات أقل، أو إصدار مستند، أو وسماً مختلفاً.',
    'Remove a filter to broaden this view.': 'أزل عامل تصفية لتوسيع هذا العرض.',
    'Create an item, then add written guidance or versioned documents.': 'أنشئ عنصراً، ثم أضف إرشادات مكتوبة أو مستندات مُصدَّرة.',
    // Client detail view.
    'Servers': 'الخوادم', 'Projects': 'المشاريع', 'Access': 'الوصول',
    'Access records': 'سجلات الوصول', 'Internal systems': 'الأنظمة الداخلية',
    'Add Access': 'إضافة وصول', 'Workspace summary': 'ملخص مساحة العمل',
    "Search this client's records…": 'ابحث في سجلات هذا العميل…',
    // Knowledge Hub article editor (Quill) toolbar — screen-reader aria-labels.
    // Quill sets these as lowercase format-name aria-label values, not title
    // tooltips (the toolbar shows icons only), so this only affects assistive
    // tech, not visible text. The picker's visible "Heading 1"/"Normal" labels
    // and the link-tooltip text are CSS ::before content, not DOM text/attrs —
    // those are translated via [lang="ar"] overrides in app.css instead.
    'bold': 'غامق', 'italic': 'مائل', 'underline': 'تسطير', 'strike': 'يتوسطه خط',
    'blockquote': 'اقتباس', 'code-block': 'كتلة برمجية', 'link': 'رابط',
    'list: ordered': 'قائمة مرقمة', 'list: bullet': 'قائمة نقطية',
  });

  // Knowledge Hub detail-view overflow menu, command palette (Ctrl+K), and
  // Settings → Maintenance diagnostics — found untranslated 2026-08-08
  // because their labels/hints are built with wording or casing that didn't
  // exactly match any existing dictionary key (dictionary lookup is exact,
  // case-sensitive text after whitespace-collapse).
  Object.assign(ar, {
    'Dialog': 'حوار', '— None —': '— بلا —', 'Keep:': 'الاحتفاظ بـ:',
    'Client workspace': 'مساحة عمل العميل', 'Go to': 'الانتقال إلى', 'Action': 'إجراء',
    'Create something…': 'إنشاء شيء…', 'Workspace view & comfort': 'عرض مساحة العمل والراحة',
    'Add record — log work': 'إضافة سجل — تسجيل عمل', 'New project': 'مشروع جديد',
    'New knowledge item': 'عنصر معرفة جديد', 'Go to today': 'الانتقال إلى اليوم',
    'Toggle dark / light theme': 'التبديل بين الوضع الداكن والفاتح',
    'Back up the database': 'نسخ قاعدة البيانات احتياطياً', 'Actions': 'الإجراءات',
    'Browse — Companies': 'تصفح — الشركات', 'Browse — Systems': 'تصفح — الأنظمة',
    'Tasks — All': 'المهام — الكل', 'Tasks — Departments': 'المهام — الأقسام',
    'Jump to date': 'الانتقال إلى تاريخ', 'Log a session': 'تسجيل جلسة',
    'Open project': 'فتح المشروع', 'Open Knowledge Hub': 'فتح مركز المعرفة',
    'Open Company Docs': 'فتح مستندات الشركة', 'Open Subscriptions': 'فتح الاشتراكات',
    'Open client access': 'فتح وصول العميل', 'Open client server': 'فتح خادم العميل',
    'Open client system': 'فتح نظام العميل', '(untitled)': '(بلا عنوان)', 'Workspace': 'مساحة العمل',
    'No matches — try a page name, task, project, or a date like 2026-07-01':
      'لا توجد نتائج — جرّب اسم صفحة أو مهمة أو مشروع أو تاريخاً مثل 2026-07-01',
    'Add document': 'إضافة مستند', 'Duplicate as draft': 'تكرار كمسودة',
    'Mark as ready': 'التحديد كجاهز', 'Move back to draft': 'الإعادة إلى مسودة',
    'Archive': 'أرشفة', 'Restore as draft': 'استعادة كمسودة', 'Delete item': 'حذف العنصر',
    'Edit organization': 'تعديل التنظيم', 'New version': 'إصدار جديد',
    'Download latest': 'تنزيل الأحدث', 'Remove latest version': 'إزالة أحدث إصدار',
    'Download': 'تنزيل', 'Remove version': 'إزالة الإصدار', 'Delete Group': 'حذف المجموعة',
    'Filter Knowledge Hub groups and tags': 'تصفية مجموعات ووسوم مركز المعرفة',
    'Could not undo': 'تعذر التراجع', 'This week': 'هذا الأسبوع',
    'No task changes recorded yet.': 'لم تُسجَّل تغييرات على المهمة بعد.',
    'Close the editor? Your changes are saved as a recoverable draft.':
      'إغلاق المحرر؟ حُفظت تغييراتك كمسودة قابلة للاستعادة.',
    'Loading users…': 'جارٍ تحميل المستخدمين…', 'No users found.': 'لم يُعثر على مستخدمين.',
    'Auditing recovery readiness…': 'جارٍ تدقيق جاهزية الاستعادة…',
    'Could not run diagnostics.': 'تعذر تشغيل التشخيص.', 'Invalid backups:': 'نسخ احتياطية غير صالحة:',
    'Missing files:': 'ملفات مفقودة:', 'Loading…': 'جارٍ التحميل…', 'Checking…': 'جارٍ الفحص…',
    'Could not run the check.': 'تعذر تشغيل الفحص.', 'Scanning…': 'جارٍ الفحص…',
    'Could not scan.': 'تعذر الفحص.', 'No duplicates found.': 'لم يُعثر على تكرارات.',
    'No sweep has run yet this session.': 'لم يتم تشغيل أي تنظيف في هذه الجلسة بعد.',
    'Client': 'العميل', 'Details': 'التفاصيل', 'This record no longer exists.': 'لم يعد هذا السجل موجوداً.',
    'What was done': 'ما تم إنجازه', 'Select a department to view its tasks': 'اختر قسماً لعرض مهامه',
    'View data table': 'عرض جدول البيانات', 'TOTAL': 'الإجمالي', 'No data.': 'لا توجد بيانات.',
    'Status:': 'الحالة:', 'Application / schema:': 'التطبيق / المخطط:', 'SQLite:': 'SQLite:',
    'Database:': 'قاعدة البيانات:', 'Disk free:': 'المساحة الحرة:',
    'Accounts / search rows:': 'الحسابات / صفوف البحث:', 'Referenced files:': 'الملفات المُشار إليها:',
    'Rotating backups:': 'النسخ الاحتياطية الدورية:', 'Credential encryption:': 'تشفير بيانات الدخول:',
    'Data folder:': 'مجلد البيانات:', 'Needs attention': 'يحتاج إلى انتباه', 'Unavailable': 'غير متاح',
    'Available on this Windows account': 'متاح على حساب Windows هذا',
    'Recovery checks passed.': 'اجتازت فحوصات الاستعادة.',
    'One or more recovery checks need attention.': 'يحتاج فحص واحد أو أكثر من فحوصات الاستعادة إلى انتباه.',
    'No backups yet — one is taken automatically on the next launch of an existing database.':
      'لا توجد نسخ احتياطية بعد — تُؤخذ نسخة تلقائياً عند التشغيل التالي لقاعدة بيانات موجودة.',
    'OK — no corruption or dangling references found.': 'سليم — لم يُعثر على تلف أو مراجع معلّقة.',
    'Problems found:': 'مشكلات تم العثور عليها:', 'Pages and actions ready': 'الصفحات والإجراءات جاهزة',
    'new entry': 'قيد جديد', 'English label': 'التسمية بالإنجليزية', 'Re-enable': 'إعادة التفعيل',
    'Move up': 'نقل لأعلى', 'Move down': 'نقل لأسفل',
    'Disable (hide from dropdowns)': 'تعطيل (إخفاء من القوائم المنسدلة)', 'e.g. ACME or 105': 'مثال: ACME أو 105',
    'No documents or written content yet': 'لا توجد مستندات أو محتوى مكتوب بعد',
    'Written knowledge item': 'عنصر معرفة مكتوب', 'Session': 'جلسة', 'Types': 'الأنواع',
    'Delete?': 'حذف؟', 'Delete group?': 'حذف المجموعة؟',
    'Delete last session? This also deletes the task.': 'حذف الجلسة الأخيرة؟ سيؤدي هذا أيضاً إلى حذف المهمة.',
  });

  const uiNounsAr = {
    clients: 'العملاء', 'company documents': 'مستندات الشركة', department: 'القسم', departments: 'الأقسام',
    'Knowledge Hub': 'مركز المعرفة', 'knowledge item': 'عنصر المعرفة', projects: 'المشاريع', records: 'السجلات',
    task: 'المهمة', tasks: 'المهام', document: 'المستند', file: 'الملف', group: 'المجموعة',
    'internal system': 'النظام الداخلي', item: 'العنصر', project: 'المشروع', server: 'الخادم',
    session: 'الجلسة', settings: 'الإعدادات', sources: 'المصادر', subscriptions: 'الاشتراكات',
    'the record': 'السجل', 'the session': 'الجلسة', 'the task': 'المهمة', 'VPN connection': 'اتصال VPN',
    merge: 'الدمج'
  };
  const orphanFolderNounAr = {
    'project folder': 'مجلد مشروع', 'company document folder': 'مجلد مستند شركة',
    'Knowledge Hub folder': 'مجلد مركز معرفة'
  };
  const arGreet = { morning: 'صباح الخير', afternoon: 'مساء الخير', evening: 'مساء الخير' };
  const arWeekdays = {
    Sunday: 'الأحد', Monday: 'الاثنين', Tuesday: 'الثلاثاء', Wednesday: 'الأربعاء',
    Thursday: 'الخميس', Friday: 'الجمعة', Saturday: 'السبت'
  };
  const arMonths = {
    January: 'يناير', February: 'فبراير', March: 'مارس', April: 'أبريل', May: 'مايو', June: 'يونيو',
    July: 'يوليو', August: 'أغسطس', September: 'سبتمبر', October: 'أكتوبر', November: 'نوفمبر', December: 'ديسمبر'
  };
  const arMonthsShort = {
    Jan: 'يناير', Feb: 'فبراير', Mar: 'مارس', Apr: 'أبريل', May: 'مايو', Jun: 'يونيو',
    Jul: 'يوليو', Aug: 'أغسطس', Sep: 'سبتمبر', Oct: 'أكتوبر', Nov: 'نوفمبر', Dec: 'ديسمبر'
  };
  const MONTH = 'January|February|March|April|May|June|July|August|September|October|November|December';
  const MON = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
  const dynamicArabicRules = [
    // Time-of-day greeting — translate the salutation, keep the person's name.
    [/^Good (morning|afternoon|evening), (.+)$/s, m => `${arGreet[m[1]]}، ${m[2]}`],
    // Full weekday date: "Wednesday, August 5, 2026"
    [new RegExp(`^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (${MONTH}) (\\d+), (\\d{4})$`, 's'),
      m => `${arWeekdays[m[1]]}، ${m[3]} ${arMonths[m[2]]} ${m[4]}`],
    // Month + year: "August 2026"
    [new RegExp(`^(${MONTH}) (\\d{4})$`, 's'), m => `${arMonths[m[1]]} ${m[2]}`],
    // Short month range: "Jan – Dec 2026"
    [new RegExp(`^(${MON}) – (${MON}) (\\d{4})$`, 's'), m => `${arMonthsShort[m[1]]} – ${arMonthsShort[m[2]]} ${m[3]}`],
    // Short month + day chart label: "Aug 1"
    [new RegExp(`^(${MON}) (\\d{1,2})$`, 's'), m => `${arMonthsShort[m[1]]} ${m[2]}`],
    // Dashboard / analytics count footers.
    [/^(\d+) records? · no previous activity$/s, m => `${m[1]} سجل · لا يوجد نشاط سابق`],
    [/^(\d+) records? · ([+-]?\d+)% vs previous period$/s, m => `${m[1]} سجل · ${m[2]}٪ مقارنة بالفترة السابقة`],
    [/^(\d+) records?$/s, m => `${m[1]} سجل`],
    [/^(\d+) days? logged$/s, m => `${m[1]} يوم مُسجَّل`],
    [/^(\d+) subscriptions?$/s, m => `${m[1]} اشتراك`],
    [/^(\d+) items? · (\d+) documents?$/s, m => `${m[1]} عنصر · ${m[2]} مستند`],
    [/^(\d+) items?$/s, m => `${m[1]} عنصر`],
    [/^(-?\d+)% of total$/s, m => `${m[1]}٪ من الإجمالي`],
    [/^(\d+) active days?$/s, m => `${m[1]} يوم نشط`],
    [/^(\d+) of (\d+) done$/s, m => `${m[1]} من ${m[2]} مكتمل`],
    // Analytics trend-chart aria-label carries a "; peak N hours, average N
    // hours" suffix the greedy plain-title rule below would otherwise leave
    // untranslated inside its own captured group — must be tried first.
    [/^Daily hours trend from (.+) to (.+); peak (.+) hours, average (.+) hours$/s,
      m => `اتجاه الساعات اليومية من ${m[1]} إلى ${m[2]}؛ الذروة ${m[3]} ساعة، المتوسط ${m[4]} ساعة`],
    [/^Daily hours trend from (.+) to (.+)$/s, m => `اتجاه الساعات اليومية من ${m[1]} إلى ${m[2]}`],
    [/^Office ONE version (.+)$/s, m => `Office ONE\nالإصدار ${m[1]}`],
    // Client-detail tab labels and section headers ("<name> (N)").
    [/^Projects \((\d+)\)$/s, m => `المشاريع (${m[1]})`],
    [/^Access \((\d+)\)$/s, m => `الوصول (${m[1]})`],
    [/^Servers \((\d+)\)$/s, m => `الخوادم (${m[1]})`],
    [/^Systems \((\d+)\)$/s, m => `الأنظمة (${m[1]})`],
    [/^Auth \((\d+)\)$/s, m => `المصادقة (${m[1]})`],
    [/^Server Information \((\d+)\)$/s, m => `معلومات الخوادم (${m[1]})`],
    [/^Internal Systems \((\d+)\)$/s, m => `الأنظمة الداخلية (${m[1]})`],
    // Client card footer: "N auth · N servers · N internal · N projects".
    [/^(\d+) auth · (\d+) servers? · (\d+) internal · (\d+) projects?$/s,
      m => `${m[1]} وصول · ${m[2]} خادم · ${m[3]} نظام داخلي · ${m[4]} مشروع`],
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
    [/^(\d+) documents?( · .+)?$/s, m => `${m[1]} مستند${m[2] || ''}`], [/^Updated today$/s, () => 'تم التحديث اليوم'],
    [/^Updated yesterday$/s, () => 'تم التحديث أمس'], [/^Updated (\d+) days? ago$/s, m => `تم التحديث منذ ${m[1]} يوم`],
    [/^Updated (\d+) weeks? ago$/s, m => `تم التحديث منذ ${m[1]} أسبوع`], [/^Updated (.+)$/s, m => `تم التحديث ${m[1]}`],
    [/^Overdue — (.+)$/s, m => `متأخر — ${m[1]}`], [/^Renews soon — (.+)$/s, m => `يتجدد قريباً — ${m[1]}`],
    [/^Renews (.+)$/s, m => `يتجدد ${m[1]}`], [/^Expires soon — (.+)$/s, m => `تنتهي الصلاحية قريباً — ${m[1]}`],
    [/^Expires (.+)$/s, m => `تنتهي الصلاحية ${m[1]}`], [/^in “(.+)”$/s, m => `ضمن «${m[1]}»`],
    [/^Full backup failed: (.+)$/s, m => `فشل النسخ الاحتياطي الكامل: ${m[1]}`],
    [/^Full restore stopped: (.+)$/s, m => `توقفت الاستعادة الكاملة: ${m[1]}`],
    // Settings → Maintenance panel: merge-picker label, palette settings-tab
    // items, and the orphan-file-sweep footer (Milestone 6 tooling).
    [/^User: (.+)$/s, m => `المستخدم: ${m[1]}`], [/^Company Code: (.+)$/s, m => `رمز الشركة: ${m[1]}`],
    [/^code: (.+)$/s, m => `رمز: ${m[1]}`],
    [/^(\d+) min · ([\d.]+) h$/s, m => `${m[1]} دقيقة · ${m[2]} ساعة`],
    // Knowledge Hub facet-section and task-sessions collapse/expand toggles.
    [/^(Expand|Collapse) (Types|Status|Groups|Tags|sessions)$/s, m => {
      const nounAr = { Types: 'الأنواع', Status: 'الحالة', Groups: 'المجموعات', Tags: 'الوسوم', sessions: 'الجلسات' }[m[2]];
      return `${m[1] === 'Expand' ? 'توسيع' : 'طي'} ${nounAr}`;
    }],
    [/^Settings — (.+)$/s, m => `الإعدادات — ${m[1]}`],
    [/^(\d+) colliding codes$/s, m => `${m[1]} رمز متعارض`],
    [/^Nothing to clean up as of the last launch \((.+)\)\.$/s, m => `لا يوجد ما يُنظَّف حتى آخر تشغيل (${m[1]}).`],
    [/^(\d+) workspace results?$/s, m => `${m[1]} نتيجة من مساحة العمل`],
    [/^Last launch \((.+)\) removed (.+)\.$/s, m => {
      const parts = m[2].split(' and ').map(seg => {
        const mm = seg.match(/^(\d+) orphaned (project folder|company document folder|Knowledge Hub folder)s?$/);
        return mm ? `${mm[1]} ${orphanFolderNounAr[mm[2]]} غير مرتبط` : seg;
      });
      return `آخر تشغيل (${m[1]}) أزال ${parts.join(' و')}.`;
    }]
  ];

  let language = readLanguage();
  // The login selector is the sole language authority. It starts with the last
  // login-page choice and is fixed for the authenticated session.
  let loginLanguageChoice = language;
  const translatedTextNodes = new Set();
  const translatedElements = new Set();
  const originals = new WeakMap();
  const attrOriginals = new WeakMap();
  let observer;

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
    // <option> values owned by the user (company/system/catalog names) carry a
    // [data-user-content] marker and are excluded below; fixed UI options built
    // at runtime (All companies, sort orders, month names…) fall through so the
    // dictionary can translate them. Unknown strings are returned unchanged, so
    // an unmarked user value that isn't a dictionary key is still left intact.
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

  // Static markup often wraps a sentence across lines, so a text node's inner
  // whitespace (newlines + indentation) differs from the single-spaced
  // dictionary key. Collapse runs of whitespace for the lookup while keeping
  // the node's leading/trailing whitespace for a faithful English restore.
  function lookupKey(value) {
    return String(value).trim().replace(/\s+/g, ' ');
  }

  function translatedValue(value) {
    const match = String(value).match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!match || !match[2]) return value;
    const key = lookupKey(match[2]);
    const result = t(key);
    return result === key ? value : match[1] + result + match[3];
  }

  function translateTextNode(node) {
    if (!isUiTextNode(node)) return;
    if (!originals.has(node)) {
      const source = lookupKey(node.nodeValue);
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
    translateTree(document.body);
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
    t, getLanguage: () => language,
    getLoginLanguageChoice: () => loginLanguageChoice,
    translateTree
  };
  window.chooseLoginLanguage = function (next) {
    if (typeof _appBooted !== 'undefined' && _appBooted) return;
    loginLanguageChoice = next;
    setLanguage(next);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
