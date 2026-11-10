# Industry Profiles — Complete Reference

**Date:** 2026-11-09
**102 Industries across 20 Categories**

Each industry profile defines: modules, submodules, roles, dashboard widgets, and CRM field mappings.

---

## Category 1: Healthcare & Wellness

### 1. Hospital Management
**Roles:** admin, doctor, nurse, receptionist, lab_technician, pharmacist, billing_officer
**Modules:**
| Module | Submodules | Key CRM Fields |
|--------|-----------|----------------|
| Patients | Registration, Directory, Medical Records, History | patient_name, phone, email, dob, blood_group, address |
| OPD/IPD | Appointments, Queue Management, Admissions, Discharge, Bed Management | appointment_date, doctor, department, ward, bed_number, diagnosis |
| Billing | Invoice Generation, Payment Collection, Insurance Claims, Outstanding | bill_amount, payment_status, insurance_id, claim_status |
| Pharmacy | Inventory, Prescriptions, Dispensing, Stock Alerts | medicine_name, quantity, batch, expiry, price |
| Lab | Test Orders, Sample Collection, Results, Reports | test_name, sample_type, result, normal_range, report_date |
| Staff | Doctor Schedules, Nurse Assignments, Shifts, Attendance | staff_name, department, shift, attendance_status |
| Dashboard | Today's OPD count, IPD count, Bed occupancy, Revenue, Pending bills, Lab queue |

### 2. Clinic & Doctor Practice
**Roles:** admin, doctor, receptionist, billing_officer
**Modules:**
| Module | Submodules |
|--------|-----------|
| Patients | Registration, Records, Visit History |
| Appointments | Scheduling, Calendar, Queue, Reminders |
| Prescriptions | Templates, Generate, History |
| Billing | Consultation Fees, Procedures, Receipts |
| Dashboard | Today's appointments, Patients seen, Revenue, Pending |

### 3. Dental Clinic
**Roles:** admin, dentist, hygienist, receptionist
**Modules:**
| Module | Submodules |
|--------|-----------|
| Patients | Registration, Dental Charts, Treatment History |
| Appointments | Scheduling, Chair Assignment, Reminders |
| Treatments | Treatment Plans, Procedures, Follow-ups |
| Billing | Treatment Costs, Insurance, Receipts |
| Dashboard | Today's patients, Chair utilization, Revenue, Follow-up due |

### 4. Diagnostic Laboratory
**Roles:** admin, pathologist, lab_technician, receptionist, delivery_agent
**Modules:**
| Module | Submodules |
|--------|-----------|
| Tests | Test Catalog, Packages, Pricing |
| Samples | Collection, Processing, Quality Control |
| Results | Entry, Validation, Report Generation |
| Delivery | Home Collection, Report Dispatch |
| Dashboard | Samples pending, Reports delivered, Revenue, Turnaround time |

### 5. Physiotherapy & Rehabilitation
**Roles:** admin, physiotherapist, receptionist
**Modules:**
| Module | Submodules |
|--------|-----------|
| Patients | Assessment, Treatment Plans, Progress Notes |
| Sessions | Scheduling, Exercise Programs, Progress Tracking |
| Equipment | Inventory, Maintenance, Booking |
| Billing | Session Packages, Insurance, Receipts |
| Dashboard | Today's sessions, Active patients, Package expiry, Revenue |

### 6. Wellness & Health Coaches
**Roles:** admin, coach, receptionist
**Modules:**
| Module | Submodules |
|--------|-----------|
| Clients | Registration, Health Assessment, Goals |
| Programs | Coaching Plans, Milestones, Check-ins |
| Sessions | Scheduling, Notes, Follow-ups |
| Content | Resources, Meal Plans, Exercise Guides |
| Dashboard | Active clients, Sessions today, Goal completion rate, Revenue |

---

## Category 2: Education & Training

### 7. School Management
**Roles:** admin, principal, teacher, accountant, admission_officer
**Modules:**
| Module | Submodules | Key CRM Fields |
|--------|-----------|----------------|
| Students | Registration, Directory, Academic Records, Promotion | student_name, parent_name, phone, class, section, roll_no |
| Admissions | Applications, Entrance Tests, Enrollment, Documents | application_date, test_score, admission_status, fee_structure |
| Fees | Fee Structure, Collection, Receipts, Defaulters, Transport | fee_amount, due_date, payment_status, receipt_no |
| Attendance | Daily Marking, Subject-wise, Reports, Alerts | date, status, subject, total_present, total_absent |
| Timetable | Class Schedule, Teacher Schedule, Substitutions | class, subject, teacher, period, room |
| Exams | Schedule, Marks Entry, Report Cards, Rankings | exam_type, subject, marks, grade, rank |
| Dashboard | Enrollment count, Fee collection, Attendance %, Upcoming exams |

### 8. College & Institution
**Roles:** admin, dean, professor, registrar, accounts_officer
**Modules:**
| Module | Submodules |
|--------|-----------|
| Students | Enrollment, Academic Records, Transcripts |
| Courses | Course Catalog, Sections, Faculty Assignment |
| Admissions | Applications, Merit Lists, Counseling |
| Fees | Fee Structure, Scholarships, Installments |
| Attendance | Digital Attendance, Reports |
| Exams | Scheduling, Evaluation, Grade Sheets |
| Dashboard | Enrollment, Course strength, Fee recovery, Placement rate |

### 9. Coaching & Training Institute
**Roles:** admin, trainer, coordinator, accounts
**Modules:**
| Module | Submodules |
|--------|-----------|
| Students | Enrollment, Batch Assignment, Progress |
| Batches | Schedule, Trainer Assignment, Capacity |
| Tests | Mock Tests, Results, Performance Analytics |
| Fees | Packages, Collection, Refunds |
| Dashboard | Active batches, Student count, Test scores, Fee recovery |

### 10. EdTech & LMS Business
**Roles:** admin, instructor, content_manager, support
**Modules:**
| Module | Submodules |
|--------|-----------|
| Courses | Course Builder, Content Management, Pricing |
| Students | Enrollment, Progress, Certifications |
| Live Classes | Scheduling, Recordings, Attendance |
| Subscriptions | Plans, Payments, Renewals |
| Dashboard | Active students, Course completion, Revenue, Churn rate |

### 11. Preschool & Daycare
**Roles:** admin, caretaker, teacher, receptionist
**Modules:**
| Module | Submodules |
|--------|-----------|
| Children | Registration, Health Records, Emergency Contacts |
| Attendance | Check-in/Out, Activity Log, Photos |
| Activities | Curriculum, Daily Schedule, Observations |
| Fees | Monthly Fees, Transport, Extra Activities |
| Dashboard | Children present, Activities today, Fee collection, Birthdays |

---

## Category 3: Real Estate & Construction

### 12. Real Estate Sales CRM ← **ALREADY BUILT (reference implementation)**
**Roles:** org_admin, venture_manager, sales_manager, sales_executive, customer
**Modules:** Ventures (3D viewer), Plot Inventory, Bookings, Commissions, Site Visits, Enquiries, Network, Payments, Discounts
**Status:** Complete — becomes the first industry profile template

### 13. Property & Plot Management
**Roles:** admin, property_manager, agent, tenant
**Modules:**
| Module | Submodules |
|--------|-----------|
| Properties | Listings, Photos/Videos, Pricing, Availability |
| Plots | Plot Registry, Ownership Records, Boundaries |
| Transactions | Sale/Purchase, Registration, Documents |
| Rental | Lease Agreements, Rent Collection, Maintenance |
| Dashboard | Properties listed, Plots sold, Revenue, Pending registrations |

### 14. Construction Project Management
**Roles:** admin, project_manager, site_engineer, contractor, accounts
**Modules:**
| Module | Submodules |
|--------|-----------|
| Projects | Project Registry, Milestones, Timelines |
| Work Orders | Task Assignment, Progress, Quality |
| Materials | Inventory, Purchase Orders, Stock |
| Workforce | Labor Tracking, Attendance, Payments |
| Dashboard | Active projects, Completion %, Material stock, Budget utilization |

### 15. Rental & Property Management
**Roles:** admin, property_manager, maintenance_coordinator, tenant
**Modules:**
| Module | Submodules |
|--------|-----------|
| Properties | Portfolio, Units, Vacancy Tracking |
| Tenants | Directory, Lease Management, Communication |
| Rent | Collection, Reminders, Receipts, Overdue |
| Maintenance | Service Requests, Vendor Assignment, Tracking |
| Dashboard | Occupancy rate, Rent collected, Pending maintenance, Expiring leases |

### 16. Interior Design Business
**Roles:** admin, designer, project_coordinator, accounts
**Modules:**
| Module | Submodules |
|--------|-----------|
| Projects | Client Briefs, Design Proposals, Timelines |
| Materials | Catalog, Sourcing, Cost Estimation |
| Invoicing | Quotations, Invoices, Payments |
| Portfolio | Completed Projects, Before/After, References |
| Dashboard | Active projects, Revenue, Pending invoices, Material costs |

---

## Categories 4–20: Summary Format

*For brevity, remaining categories list modules and roles only. Full submodule detail follows the same pattern as above.*

---

## Category 4: Finance & Insurance

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 17 | Loan & DSA Management | admin, dsa_manager, dsa_agent, accounts | Loan Applications, DSA Network, Disbursements, Collections, Commissions |
| 18 | Insurance Agency Management | admin, agency_manager, agent, claims_officer | Policies, Leads, Renewals, Claims, Commissions |
| 19 | Financial Advisory CRM | admin, advisor, relationship_manager, compliance | Clients, Portfolios, Transactions, Advisory Plans, Compliance |
| 20 | Chit Fund Operations | admin, branch_manager, collector, auditor | Chit Groups, Members, Auctions, Collections, Dividends |
| 21 | Accounting & Tax Consultancy | admin, ca, tax_consultant, clerk | Clients, Tax Filings, Compliance Calendar, Invoicing, Documents |

## Category 5: Retail & E-commerce

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 22 | Retail Store Management | admin, store_manager, cashier, stock_keeper | Inventory, POS/Billing, Customers, Suppliers, Reports |
| 23 | E-commerce Business | admin, catalog_manager, order_manager, support | Products, Orders, Shipping, Returns, Customers |
| 24 | Wholesale & Distribution | admin, sales_manager, warehouse_manager, driver | Products, Orders, Routes, Warehouse, Collections |
| 25 | Supermarket & Grocery | admin, floor_manager, cashier, stock_keeper | Categories, Inventory, Billing, Offers, Suppliers |
| 26 | Jewellery Showroom | admin, showroom_manager, sales, goldsmith | Collections, Karats/Pricing, Orders, Repairs, Schemes |

## Category 6: Professional Services

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 27 | Law Firm & Legal Practice | admin, partner, associate, paralegal | Cases, Clients, Court Dates, Documents, Billing/Hours |
| 28 | Chartered Accountant Firm | admin, partner, ca, article_clerk | Clients, Audits, Tax Returns, Compliance, Billing |
| 29 | Business Consulting | admin, consultant, project_manager, analyst | Projects, Clients, Deliverables, Time Tracking, Invoicing |
| 30 | Digital Marketing Agency | admin, account_manager, creative, seo_specialist | Clients, Campaigns, Content Calendar, Analytics, Invoicing |
| 31 | IT Services & Software Agency | admin, project_manager, developer, qa | Projects, Tickets, Sprints, Clients, Invoicing |

## Category 7: Hospitality & Travel

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 32 | Hotel & Resort Management | admin, front_desk, housekeeping, f_and_b | Reservations, Rooms, Guests, Billing, Housekeeping |
| 33 | Travel Agency & Tour Operator | admin, travel_consultant, operations, accounts | Packages, Bookings, Itineraries, Vendors, Invoicing |
| 34 | Restaurant & Cafe Management | admin, chef, server, cashier | Menu, Tables, Orders, Kitchen Display, Billing |
| 35 | Catering Services | admin, chef, coordinator, delivery | Events, Menu Planning, Orders, Delivery, Invoicing |
| 36 | Event Venue & Banquet Hall | admin, event_manager, operations, accounts | Venues, Bookings, Events, Catering, Billing |

## Category 8: Automotive & Transport

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 37 | Car Dealership | admin, sales_manager, sales_exec, service_advisor | Vehicles, Leads, Test Drives, Financing, Delivery |
| 38 | Two-Wheeler Dealership | admin, showroom_manager, sales, service | Vehicles, Leads, Bookings, Service, Exchange |
| 39 | Automobile Service Center | admin, service_advisor, technician, parts | Service Jobs, Vehicle Registry, Parts, Invoicing |
| 40 | Vehicle Rental Business | admin, fleet_manager, booking_agent, driver | Fleet, Bookings, Customers, Maintenance, Invoicing |
| 41 | Logistics & Fleet Management | admin, dispatcher, driver, maintenance | Vehicles, Routes, Trips, Fuel, Maintenance |

## Category 9: Beauty & Lifestyle

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 42 | Beauty Salon | admin, stylist, receptionist | Appointments, Services, Staff Schedule, Packages, POS |
| 43 | Spa & Wellness Center | admin, therapist, receptionist | Appointments, Treatments, Memberships, Products |
| 44 | Fitness Gym | admin, trainer, receptionist | Members, Memberships, Classes, Equipment, Check-in |
| 45 | Yoga & Meditation Studio | admin, instructor, receptionist | Classes, Members, Packages, Schedule |
| 46 | Fashion Boutique | admin, designer, sales | Collections, Orders, Customers, Alterations, POS |

## Category 10: Agriculture & Food

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 47 | Agri Input Dealership | admin, sales, warehouse, delivery | Products, Orders, Farmers, Credit, Stock |
| 48 | Farm Produce Trading | admin, trader, procurement, logistics | Commodities, Procurement, Sales, Transport, Payments |
| 49 | Dairy Business | admin, collection_agent, quality, dispatch | Farmers, Collection, Quality Testing, Distribution |
| 50 | Poultry Farm Operations | admin, farm_manager, sales | Flocks, Production, Feed, Sales, Health |
| 51 | Food Processing Business | admin, production_manager, quality, sales | Products, Batches, Quality, Orders, Dispatch |

## Category 11: Manufacturing & Industrial

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 52 | Manufacturing Operations | admin, production_manager, quality, maintenance | Products, Production Orders, Quality, Machines, Inventory |
| 53 | Industrial Equipment Sales | admin, sales_manager, sales, service | Equipment, Leads, Orders, Service Contracts, AMC |
| 54 | Textile & Garment Manufacturing | admin, production, design, quality | Designs, Orders, Production, Quality, Dispatch |
| 55 | Furniture Manufacturing | admin, designer, production, sales | Catalog, Orders, Production, Delivery |
| 56 | Packaging Industry | admin, production, sales, design | Products, Orders, Printing, Dispatch |

## Category 12: Home & Local Services

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 57 | Home Cleaning Services | admin, supervisor, cleaner, dispatcher | Bookings, Schedule, Teams, Customers, Invoicing |
| 58 | Pest Control Services | admin, technician, dispatcher | Bookings, Service History, Chemicals, Reports |
| 59 | Electrical & Plumbing Services | admin, technician, dispatcher | Service Requests, Scheduling, Parts, Invoicing |
| 60 | Home Appliance Repair | admin, technician, dispatcher | Service Calls, Parts, Warranty, Invoicing |
| 61 | Security & Facility Management | admin, site_manager, guard, hr | Sites, Guards, Shifts, Attendance, Invoicing |

## Category 13: Media & Entertainment

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 62 | Photography & Videography Studio | admin, photographer, editor, coordinator | Events, Bookings, Albums, Editing Queue, Invoicing |
| 63 | Film & Video Production | admin, producer, director, coordinator | Projects, Cast/Crew, Schedule, Budget, Deliverables |
| 64 | Influencer & Creator Management | admin, manager, creator, analyst | Creators, Campaigns, Content, Analytics, Payments |
| 65 | Advertising & Branding Agency | admin, creative_director, designer, account_manager | Clients, Campaigns, Creatives, Approvals, Billing |
| 66 | Media & Publishing Business | admin, editor, writer, designer | Publications, Content, Editorial Calendar, Distribution |

## Category 14: Events & Communities

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 67 | Event Management | admin, event_manager, coordinator, vendor_manager | Events, Vendors, Guests, Budget, Timeline |
| 68 | Wedding Planning | admin, planner, coordinator, vendor_manager | Weddings, Vendors, Tasks, Budget, Guest List |
| 69 | Exhibition & Trade Show Management | admin, organizer, exhibitor_manager, ops | Exhibitions, Stalls, Exhibitors, Visitors, Invoicing |
| 70 | Membership Association | admin, secretary, treasurer, membership_officer | Members, Fees, Events, Communications, Elections |
| 71 | Awards & Conference Management | admin, organizer, jury_coordinator, speaker_manager | Events, Nominations, Jury, Speakers, Registrations |

## Category 15: HR & Recruitment

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 72 | Recruitment Agency | admin, recruiter, account_manager | Jobs, Candidates, Interviews, Placements, Invoicing |
| 73 | Staffing & Manpower Agency | admin, coordinator, compliance, accounts | Workers, Deployments, Attendance, Invoicing, Compliance |
| 74 | Corporate HR Operations | admin, hr_manager, hr_executive, payroll | Employees, Leave, Attendance, Payroll, Performance |
| 75 | Employee Training & Development | admin, trainer, coordinator | Programs, Trainees, Assessments, Certifications |
| 76 | Payroll & Compliance Services | admin, payroll_officer, compliance_officer | Clients, Employees, Payroll Runs, Filings, Reports |

## Category 16: Nonprofit & Public Programs

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 77 | NGO Management | admin, program_manager, field_worker, accounts | Programs, Beneficiaries, Donors, Reports, Expenses |
| 78 | Fundraising & Donor Management | admin, fundraiser, donor_relations | Campaigns, Donors, Pledges, Receipts, Impact |
| 79 | CSR Program Management | admin, program_coordinator, impact_analyst | Projects, Partners, Beneficiaries, Budget, Impact |
| 80 | Community Development Organization | admin, coordinator, community_worker | Communities, Projects, Members, Events, Reports |
| 81 | Skill Development Center | admin, trainer, placement_officer | Courses, Trainees, Assessments, Placements, Certificates |

## Category 17: Technology & Digital Businesses

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 82 | SaaS Customer Operations | admin, cs_manager, cs_agent, onboarding | Customers, Subscriptions, Tickets, Onboarding, Health Score |
| 83 | AI Automation Agency | admin, solution_architect, developer, pm | Projects, Clients, Automations, Deployments, Billing |
| 84 | Website Development Agency | admin, pm, developer, designer | Projects, Clients, Milestones, Hosting, Invoicing |
| 85 | Digital Product Business | admin, product_manager, developer, support | Products, Customers, Licenses, Support Tickets |
| 86 | Managed IT Support | admin, service_manager, technician | Clients, Tickets, SLA Tracking, Assets, Invoicing |

## Category 18: B2B Sales & Distribution

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 87 | FMCG Distributor | admin, sales_manager, salesman, warehouse | Retailers, Orders, Routes, Stock, Collections |
| 88 | Pharmaceutical Distributor | admin, sales, compliance, warehouse | Products, Retailers, Orders, Expiry Tracking, Returns |
| 89 | Building Materials Supplier | admin, sales, warehouse, delivery | Products, Dealers, Orders, Stock, Delivery |
| 90 | Electrical & Hardware Distributor | admin, sales, warehouse, billing | Products, Dealers, Orders, Stock, Credits |
| 91 | Industrial B2B Sales | admin, sales_manager, sales_exec, service | Products, Clients, Quotations, Orders, AMC |

## Category 19: Specialized Healthcare & Care

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 92 | Veterinary Clinic | admin, veterinarian, assistant | Pets/Animals, Owners, Appointments, Treatments, Billing |
| 93 | Home Healthcare Services | admin, coordinator, nurse, caregiver | Patients, Visits, Care Plans, Staff Schedule, Billing |
| 94 | Elder Care Services | admin, care_manager, caregiver | Residents, Care Plans, Activities, Health, Billing |
| 95 | Mental Wellness Practice | admin, therapist, receptionist | Clients, Sessions, Notes, Progress, Billing |
| 96 | Nutrition & Diet Consultation | admin, nutritionist, receptionist | Clients, Diet Plans, Assessments, Follow-ups, Billing |

## Category 20: Premium & Emerging Markets

| # | Industry | Roles | Key Modules |
|---|----------|-------|-------------|
| 97 | Franchise Network Management | admin, franchise_manager, franchise_owner | Franchise Units, Performance, Royalties, Compliance, Support |
| 98 | Coworking Space Management | admin, space_manager, community_manager | Spaces, Members, Bookings, Billing, Events |
| 99 | Solar Energy Business | admin, sales, project_manager, technician | Leads, Proposals, Projects, Installation, Service |
| 100 | EV Charging & Service Business | admin, station_manager, technician | Stations, Chargers, Sessions, Maintenance, Billing |
| 101 | Luxury Concierge Services | admin, concierge, relationship_manager | Clients, Requests, Vendors, Events, Invoicing |
