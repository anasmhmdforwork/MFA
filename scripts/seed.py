import openpyxl
import json
import os
from datetime import datetime, timedelta

excel_path = r'C:/Users/MR 10/.gemini/antigravity/brain/27510223-53d7-4f22-8860-3352843d3fb0/.user_uploaded/media_1792673808592_dc6eb3e7.xlsx'
wb = openpyxl.load_workbook(excel_path, data_only=True)

committees_meta = [
    {
        'id': 'crises',
        'name': 'البحث والتقديرات والتخطيط السياسي وإدارة الأزمات',
        'shortName': 'التخطيط السياسي وإدارة الأزمات',
        'slug': 'crises',
        'color': '#e11d48',
        'badge': 'bg-rose-100 text-rose-800 border-rose-200',
        'icon': 'shield-alert',
        'headUsername': 'crises_head',
        'headName': 'مدير لجنة التخطيط السياسي وإدارة الأزمات',
        'password': 'mofa1234',
        'description': 'تحليل المواقف الجيوسياسية، استشراف السيناريوهات، وإدارة الأزمات الدبلوماسية المعقدة'
    },
    {
        'id': 'economic',
        'name': 'التعاون الاقتصادي متعدد الأطراف والإقليمي',
        'shortName': 'التعاون الاقتصادي',
        'slug': 'economic',
        'color': '#059669',
        'badge': 'bg-emerald-100 text-emerald-800 border-emerald-200',
        'icon': 'trending-up',
        'headUsername': 'economic_head',
        'headName': 'مدير لجنة التعاون الاقتصادي',
        'password': 'mofa1234',
        'description': 'الاتفاقيات الاقتصادية، التكتلات التجارية، والدبلوماسية الاقتصادية الدولية'
    },
    {
        'id': 'security',
        'name': 'الشئون متعددة الأطراف والأمن الدولي',
        'shortName': 'الأمن الدولي',
        'slug': 'security',
        'color': '#2563eb',
        'badge': 'bg-blue-100 text-blue-800 border-blue-200',
        'icon': 'globe-lock',
        'headUsername': 'security_head',
        'headName': 'مدير لجنة الشئون متعددة الأطراف والأمن الدولي',
        'password': 'mofa1234',
        'description': 'المنظمات الدولية، الأمم المتحدة، قضايا حفظ السلام ونزع السلاح والأمن الإقليمي'
    },
    {
        'id': 'arab',
        'name': 'الشئون العربية',
        'shortName': 'الشئون العربية',
        'slug': 'arab',
        'color': '#0891b2',
        'badge': 'bg-cyan-100 text-cyan-800 border-cyan-200',
        'icon': 'landmark',
        'headUsername': 'arab_head',
        'headName': 'مدير لجنة الشئون العربية',
        'password': 'mofa1234',
        'description': 'العمل العربي المشترك، جامعة الدول العربية، وملفات الأمن القومي بالمنطقة'
    },
    {
        'id': 'climate',
        'name': 'المناخ والبيئة والتنمية المستدامة',
        'shortName': 'المناخ والبيئة',
        'slug': 'climate',
        'color': '#16a34a',
        'badge': 'bg-green-100 text-green-800 border-green-200',
        'icon': 'leaf',
        'headUsername': 'climate_head',
        'headName': 'مدير لجنة المناخ والتنمية المستدامة',
        'password': 'mofa1234',
        'description': 'دبلوماسية المناخ، التنمية المستدامة، اتفاقيات البيئة والتحول الأخضر'
    },
    {
        'id': 'digital',
        'name': 'الاتصالات ونظم المعلومات والتحول الرقمي',
        'shortName': 'التحول الرقمي',
        'slug': 'digital',
        'color': '#7c3aed',
        'badge': 'bg-purple-100 text-purple-800 border-purple-200',
        'icon': 'cpu',
        'headUsername': 'digital_head',
        'headName': 'مدير لجنة الاتصالات والتحول الرقمي',
        'password': 'mofa1234',
        'description': 'الدبلوماسية الرقمية، الأمن السيبراني، الذكاء الاصطناعي، والاتصال الاستراتيجي'
    },
    {
        'id': 'palestine',
        'name': 'فلسطين',
        'shortName': 'فلسطين',
        'slug': 'palestine',
        'color': '#b91c1c',
        'badge': 'bg-rose-100 text-rose-800 border-rose-200',
        'icon': 'flag',
        'headUsername': 'palestine_head',
        'headName': 'مدير لجنة فلسطين',
        'password': 'mofa1234',
        'description': 'القضية الفلسطينية، القانون الدولي الإنساني، والمساعي الدبلوماسية لدعم الحقوق المشروعة'
    },
    {
        'id': 'american',
        'name': 'الشئون الأمريكية',
        'shortName': 'الشئون الأمريكية',
        'slug': 'american',
        'color': '#0284c7',
        'badge': 'bg-sky-100 text-sky-800 border-sky-200',
        'icon': 'building-2',
        'headUsername': 'american_head',
        'headName': 'مدير لجنة الشئون الأمريكية',
        'password': 'mofa1234',
        'description': 'العلاقات الاستراتيجية الثنائية مع الولايات المتحدة الأمريكية ودول الأمريكتين'
    },
    {
        'id': 'africa',
        'name': 'شئون أفريقيا',
        'shortName': 'شئون أفريقيا',
        'slug': 'africa',
        'color': '#d97706',
        'badge': 'bg-amber-100 text-amber-800 border-amber-200',
        'icon': 'compass',
        'headUsername': 'africa_head',
        'headName': 'مدير لجنة شئون أفريقيا',
        'password': 'mofa1234',
        'description': 'العمق الاستراتيجي المصري، الاتحاد الأفريقي، الشراكات التنموية والأمن المائي'
    }
]

name_to_comm = {c['name']: c for c in committees_meta}

# Master sheet
master_sheet = [s for s in wb.worksheets if s.max_row == 439][0]
rows = list(master_sheet.iter_rows(values_only=True))

candidates = []
for i, r in enumerate(rows[1:], start=1):
    pref = str(r[9]).strip() if r[9] is not None else ''
    comm = name_to_comm.get(pref)
    comm_id = comm['id'] if comm else 'arab'
    
    cand = {
        'id': f'c_{i}',
        'num': i,
        'arabicName': str(r[1]).strip() if r[1] is not None else '',
        'fullName': str(r[2]).strip() if r[2] is not None else '',
        'university': str(r[3]).strip() if r[3] is not None else '',
        'priority': r[4] if r[4] is not None else 1,
        'faculty': str(r[5]).strip() if r[5] is not None else '',
        'grade': str(r[6]).strip() if r[6] is not None else '',
        'phone': str(r[7]).strip() if r[7] is not None else '',
        'email': str(r[8]).strip() if r[8] is not None else '',
        'firstPreference': pref,
        'originalCommitteeId': comm_id,
        'assignedCommitteeId': comm_id,
        'allPreferences': str(r[10]).strip() if r[10] is not None else '',
        'trackPreference': str(r[11]).strip() if r[11] is not None else 'الأكاديمي',
        'englishLevel': str(r[12]).strip() if r[12] is not None else 'متوسط',
        'pastActivities': str(r[13]).strip() if r[13] is not None else '',
        'activitiesDetails': str(r[14]).strip() if r[14] is not None else '',
        'reasonsForSectors': str(r[15]).strip() if r[15] is not None else '',
        'motivation': str(r[16]).strip() if r[16] is not None else '',
        'skills': str(r[17]).strip() if r[17] is not None else '',
        'topSkill': str(r[18]).strip() if r[18] is not None else '',
        'attendanceCommitment': str(r[19]).strip() if r[19] is not None else '',
        'referralSource': str(r[20]).strip() if r[20] is not None else '',
        'submissionTime': str(r[21]).strip() if r[21] is not None else '',
        
        # Interview & Booking status
        'bookingStatus': 'pending', # 'pending' | 'booked' | 'completed' | 'absent' | 'excused'
        'slotId': None,
        'slotInfo': None,
        
        # Evaluation & Interviewer fields
        'interviewStatus': 'pending', # 'pending' | 'completed' | 'absent' | 'excused'
        'evaluation': {
            'attended': False,
            'attendanceStatus': 'pending', # 'attended' | 'absent' | 'excused'
            'score': None, # 1 to 10
            'communicationScore': None,
            'knowledgeScore': None,
            'commitmentScore': None,
            'englishScore': None,
            'notes': '',
            'decision': 'pending', # 'pending' | 'accepted' | 'reserve' | 'rejected' | 'transferred'
            'interviewerName': '',
            'evaluatedAt': None
        },
        'transferHistory': []
    }
    candidates.append(cand)

# Parse Secondary Preferences for each committee from sub-sheets
secondary_prefs = {c['id']: [] for c in committees_meta}
for s in wb.worksheets:
    title_cell = s.cell(row=1, column=1).value or ''
    for comm in committees_meta:
        if comm['name'] in str(title_cell):
            for r in s.iter_rows(min_row=3, values_only=True):
                name = str(r[1]).strip() if len(r) > 1 and r[1] is not None else ''
                pref_type = str(r[4]).strip() if len(r) > 4 and r[4] is not None else ''
                first_pref_of_cand = str(r[5]).strip() if len(r) > 5 and r[5] is not None else ''
                phone = str(r[8]).strip() if len(r) > 8 and r[8] is not None else ''
                if name and pref_type == 'رغبة أخرى':
                    secondary_prefs[comm['id']].append({
                        'name': name,
                        'phone': phone,
                        'firstPreference': first_pref_of_cand,
                        'university': str(r[2]).strip() if len(r) > 2 and r[2] is not None else '',
                        'faculty': str(r[6]).strip() if len(r) > 6 and r[6] is not None else '',
                        'grade': str(r[7]).strip() if len(r) > 7 and r[7] is not None else ''
                    })
            break

# Create users list
users = [
    {
        'id': 'u_admin',
        'username': 'admin',
        'name': 'رئيس النموذج (الإدارة المركزية)',
        'role': 'admin',
        'committeeId': None,
        'committeeName': 'جميع اللجان والقطاعات',
        'password': 'admin1234'
    }
]

for c in committees_meta:
    c_id = c['id']
    users.append({
        'id': 'u_' + c_id,
        'username': c['headUsername'],
        'name': c['headName'],
        'role': 'committee_head',
        'committeeId': c_id,
        'committeeName': c['name'],
        'committeeSlug': c['slug'],
        'password': c['password']
    })
    # Also short username (e.g. 'crises', 'arab', 'palestine')
    users.append({
        'id': 'u_' + c_id + '_short',
        'username': c['slug'],
        'name': c['headName'],
        'role': 'committee_head',
        'committeeId': c_id,
        'committeeName': c['name'],
        'committeeSlug': c['slug'],
        'password': c['password']
    })

# Generate realistic starter interview slots for each committee across upcoming days
# to showcase the application fully in action immediately!
slots = []
slot_batches = []
slot_counter = 1

days_schedule = [
    {'date': '2026-10-25', 'dayNameAr': 'الأحد', 'dateDisplay': 'الأحد 25 أكتوبر 2026'},
    {'date': '2026-10-26', 'dayNameAr': 'الإثنين', 'dateDisplay': 'الإثنين 26 أكتوبر 2026'},
    {'date': '2026-10-27', 'dayNameAr': 'الثلاثاء', 'dateDisplay': 'الثلاثاء 27 أكتوبر 2026'}
]

for c in committees_meta:
    c_id = c['id']
    # Online Batch: Day 1 (5:00 PM to 8:00 PM, 15 min each = 12 slots)
    batch_1_id = f'batch_{c_id}_1'
    slot_batches.append({
        'id': batch_1_id,
        'committeeId': c_id,
        'date': days_schedule[0]['date'],
        'dayNameAr': days_schedule[0]['dayNameAr'],
        'dateDisplay': days_schedule[0]['dateDisplay'],
        'startTime': '17:00',
        'endTime': '20:00',
        'durationMinutes': 15,
        'breakMinutes': 0,
        'type': 'online',
        'locationOrLink': 'https://meet.google.com/mofa-' + c_id + '-2026',
        'notes': 'المقابلة عبر Google Meet - يرجى الالتزام بالموعد والدخول قبل الموعد بـ 5 دقائق',
        'totalSlots': 12,
        'createdAt': '2026-10-22T16:00:00'
    })
    
    # Generate 12 slots for Batch 1
    t = datetime.strptime('17:00', '%H:%M')
    for s_idx in range(12):
        s_start = t.strftime('%I:%M %p').replace('AM', 'ص').replace('PM', 'م')
        t_end = t + timedelta(minutes=15)
        s_end = t_end.strftime('%I:%M %p').replace('AM', 'ص').replace('PM', 'م')
        
        slots.append({
            'id': f'slot_{slot_counter}',
            'batchId': batch_1_id,
            'committeeId': c_id,
            'date': days_schedule[0]['date'],
            'dayNameAr': days_schedule[0]['dayNameAr'],
            'dateDisplay': days_schedule[0]['dateDisplay'],
            'startTime24': t.strftime('%H:%M'),
            'endTime24': t_end.strftime('%H:%M'),
            'timeDisplay': f'{s_start} - {s_end}',
            'durationMinutes': 15,
            'type': 'online',
            'locationOrLink': 'https://meet.google.com/mofa-' + c_id + '-2026',
            'status': 'available', # 'available' | 'booked' | 'locked'
            'candidateId': None,
            'candidateName': None,
            'candidatePhone': None,
            'notes': ''
        })
        slot_counter += 1
        t = t_end

    # Offline Batch: Day 2 (11:00 AM to 02:00 PM, 15 min each = 12 slots)
    batch_2_id = f'batch_{c_id}_2'
    slot_batches.append({
        'id': batch_2_id,
        'committeeId': c_id,
        'date': days_schedule[1]['date'],
        'dayNameAr': days_schedule[1]['dayNameAr'],
        'dateDisplay': days_schedule[1]['dateDisplay'],
        'startTime': '11:00',
        'endTime': '14:00',
        'durationMinutes': 15,
        'breakMinutes': 0,
        'type': 'offline',
        'locationOrLink': 'قاعة المؤتمرات - مبنى كلية السياسة والاقتصاد - جامعة السويس',
        'notes': 'المقابلة حضورية - يرجى إحضار كارنيه الكلية أو إثبات الشخصية',
        'totalSlots': 12,
        'createdAt': '2026-10-22T16:00:00'
    })
    
    t = datetime.strptime('11:00', '%H:%M')
    for s_idx in range(12):
        s_start = t.strftime('%I:%M %p').replace('AM', 'ص').replace('PM', 'م')
        t_end = t + timedelta(minutes=15)
        s_end = t_end.strftime('%I:%M %p').replace('AM', 'ص').replace('PM', 'م')
        
        slots.append({
            'id': f'slot_{slot_counter}',
            'batchId': batch_2_id,
            'committeeId': c_id,
            'date': days_schedule[1]['date'],
            'dayNameAr': days_schedule[1]['dayNameAr'],
            'dateDisplay': days_schedule[1]['dateDisplay'],
            'startTime24': t.strftime('%H:%M'),
            'endTime24': t_end.strftime('%H:%M'),
            'timeDisplay': f'{s_start} - {s_end}',
            'durationMinutes': 15,
            'type': 'offline',
            'locationOrLink': 'قاعة المؤتمرات - مبنى كلية السياسة والاقتصاد - جامعة السويس',
            'status': 'available',
            'candidateId': None,
            'candidateName': None,
            'candidatePhone': None,
            'notes': ''
        })
        slot_counter += 1
        t = t_end

# Let's pre-book a few candidates across committees and add sample evaluations
# to make the dashboard feel alive and demonstrate all features immediately!
demo_bookings = [
    # Palestine
    {'c_index': 0, 'slot_idx': 0, 'attended': True, 'score': 9, 'decision': 'accepted', 'notes': 'ممتازة جداً في مهارات التفاوض ومعرفة القضية الفلسطينية'},
    # Crises
    {'c_index': 1, 'slot_idx': 24, 'attended': True, 'score': 8.5, 'decision': 'accepted', 'notes': 'إمكانيات تحليلية جيدة ومتحمسة للبحث الأكاديمي'},
    # Economic
    {'c_index': 2, 'slot_idx': 48, 'attended': True, 'score': 7.5, 'decision': 'reserve', 'notes': 'مهارات تنظيمية عالية، يحتاج دعم في المصطلحات الاقتصادية'},
    # Security
    {'c_index': 3, 'slot_idx': 72, 'attended': False, 'score': None, 'decision': 'pending', 'notes': 'اعتذر مسبقاً لظرف طارئ - يحتاج إعادة جدولة'},
    # Arab
    {'c_index': 11, 'slot_idx': 96, 'attended': True, 'score': 9.5, 'decision': 'accepted', 'notes': 'شخصية قيادية واعية وملم بالقضايا العربية'}
]

for b in demo_bookings:
    if b['c_index'] < len(candidates) and b['slot_idx'] < len(slots):
        cand = candidates[b['c_index']]
        slot = slots[b['slot_idx']]
        
        slot['status'] = 'booked'
        slot['candidateId'] = cand['id']
        slot['candidateName'] = cand['arabicName']
        slot['candidatePhone'] = cand['phone']
        
        cand['bookingStatus'] = 'completed' if b['attended'] else ('booked' if b['score'] is None else 'absent')
        cand['slotId'] = slot['id']
        cand['slotInfo'] = {
            'date': slot['date'],
            'dateDisplay': slot['dateDisplay'],
            'timeDisplay': slot['timeDisplay'],
            'type': slot['type'],
            'locationOrLink': slot['locationOrLink']
        }
        cand['interviewStatus'] = 'completed' if b['attended'] else 'pending'
        cand['evaluation'] = {
            'attended': b['attended'],
            'attendanceStatus': 'attended' if b['attended'] else ('excused' if 'اعتذر' in b['notes'] else 'pending'),
            'score': b['score'],
            'communicationScore': b['score'],
            'knowledgeScore': b['score'],
            'commitmentScore': b['score'],
            'englishScore': b['score'],
            'notes': b['notes'],
            'decision': b['decision'],
            'interviewerName': 'مدير اللجنة',
            'evaluatedAt': '2026-10-22T12:00:00' if b['score'] else None
        }

db_data = {
    'meta': {
        'title': 'نظام مقابلات نموذج محاكاة وزارة الخارجية المصرية - جامعة السويس',
        'season': '2026/2027',
        'version': '1.0.0',
        'createdAt': '2026-10-22',
        'totalCandidates': len(candidates)
    },
    'committees': committees_meta,
    'users': users,
    'candidates': candidates,
    'secondaryPreferences': secondary_prefs,
    'slots': slots,
    'slotBatches': slot_batches,
    'transferAuditLogs': [
        {
            'id': 'log_1',
            'candidateId': 'c_5',
            'candidateName': 'يوسف محمود سعد',
            'fromCommitteeId': 'economic',
            'fromCommitteeName': 'التعاون الاقتصادي متعدد الأطراف والإقليمي',
            'toCommitteeId': 'crises',
            'toCommitteeName': 'البحث والتقديرات والتخطيط السياسي وإدارة الأزمات',
            'reason': 'مناسب أكثر لملف التخطيط السياسي وإدارة الأزمات',
            'transferredBy': 'رئيس النموذج',
            'timestamp': '2026-10-22T10:30:00'
        }
    ]
}

os.makedirs('data', exist_ok=True)
with open('data/db.json', 'w', encoding='utf-8') as f:
    json.dump(db_data, f, ensure_ascii=False, indent=2)

print(f'Done! Successfully generated data/db.json with {len(candidates)} candidates and {len(slots)} interview slots.')
