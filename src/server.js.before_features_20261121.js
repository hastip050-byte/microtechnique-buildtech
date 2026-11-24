require('dotenv').config();
const express=require('express'), session=require('express-session'), SQLiteStore=require('connect-sqlite3')(session);
const Database=require('better-sqlite3'), bcrypt=require('bcryptjs'), helmet=require('helmet'), rateLimit=require('express-rate-limit'), morgan=require('morgan'), path=require('path'), fs=require('fs');
const app=express(), PORT=Number(process.env.PORT||3000), dataDir=path.join(__dirname,'..','data'); fs.mkdirSync(dataDir,{recursive:true});
const db=new Database(path.join(dataDir,'buildtech.db')); db.pragma('journal_mode=WAL'); db.pragma('foreign_keys=ON');

function createNotification(userId,title,message){
  db.prepare(`
    INSERT INTO notifications(user_id,title,message)
    VALUES(?,?,?)
  `).run(
    Number(userId),
    clean(title),
    clean(message)
  );
}

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT,password_hash TEXT NOT NULL,role TEXT NOT NULL,verified INTEGER DEFAULT 0,status TEXT DEFAULT 'active',preferred_language TEXT DEFAULT 'en',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS properties(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,purpose TEXT NOT NULL,category TEXT NOT NULL,country TEXT DEFAULT 'India',state TEXT,district TEXT,city TEXT NOT NULL,village TEXT,locality TEXT NOT NULL,pincode TEXT,address TEXT,price INTEGER NOT NULL,area REAL,bhk INTEGER,description TEXT,furnishing TEXT,amenities TEXT,status TEXT DEFAULT 'pending',rera_number TEXT,rera_applicable INTEGER DEFAULT 0,featured INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS favourites(user_id INTEGER REFERENCES users(id),property_id INTEGER REFERENCES properties(id),created_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,property_id));
CREATE TABLE IF NOT EXISTS enquiries(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id),property_id INTEGER REFERENCES properties(id),name TEXT,phone TEXT,message TEXT,status TEXT DEFAULT 'new',created_at TEXT DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS visits(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id),property_id INTEGER REFERENCES properties(id),visit_date TEXT,message TEXT,status TEXT DEFAULT 'requested',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS loans(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id),loan_amount INTEGER,property_value INTEGER,income INTEGER,tenure_years INTEGER,status TEXT DEFAULT 'submitted',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS service_enquiries(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id),service TEXT,name TEXT,phone TEXT,details TEXT,status TEXT DEFAULT 'new',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS verification_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id),account_type TEXT,details TEXT,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS subscriptions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id),plan TEXT,amount INTEGER,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER REFERENCES users(id),title TEXT,message TEXT,read INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS audit_logs(id INTEGER PRIMARY KEY AUTOINCREMENT,admin_id INTEGER,action TEXT,entity TEXT,entity_id INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS featured_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id),
  discount_label TEXT,
  offer_price INTEGER DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS builder_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  builder_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  state TEXT,
  district TEXT,
  city TEXT NOT NULL,
  locality TEXT,
  project_type TEXT,
  rera_number TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES builder_projects(id),
  unit_type TEXT NOT NULL,
  total_units INTEGER DEFAULT 0,
  available_units INTEGER DEFAULT 0,
  price_from INTEGER DEFAULT 0,
  area_from REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partner_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  interest TEXT,
  notes TEXT,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investor_enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES users(id),
  opportunity TEXT NOT NULL,
  budget INTEGER DEFAULT 0,
  message TEXT,
  status TEXT DEFAULT 'new',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partner_commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_id INTEGER NOT NULL REFERENCES partner_referrals(id),
  partner_id INTEGER NOT NULL REFERENCES users(id),
  sale_value INTEGER NOT NULL,
  commission_rate REAL NOT NULL,
  commission_amount INTEGER NOT NULL,
  approved_by INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'pending',
  paid_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_properties_search ON properties(status,purpose,city,price);
CREATE INDEX IF NOT EXISTS idx_properties_location ON properties(state,district,city,village,pincode);
CREATE INDEX IF NOT EXISTS idx_enquiries_user ON enquiries(user_id,created_at);
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_properties_owner
  ON properties(owner_id);

  CREATE INDEX IF NOT EXISTS idx_properties_status
  ON properties(status);

  CREATE INDEX IF NOT EXISTS idx_properties_location
  ON properties(state,district,city,pincode);

  CREATE INDEX IF NOT EXISTS idx_enquiries_user
  ON enquiries(user_id);

  CREATE INDEX IF NOT EXISTS idx_enquiries_property
  ON enquiries(property_id);

  CREATE INDEX IF NOT EXISTS idx_visits_user
  ON visits(user_id);

  CREATE INDEX IF NOT EXISTS idx_visits_property
  ON visits(property_id);

  CREATE INDEX IF NOT EXISTS idx_loans_user
  ON loans(user_id);

  CREATE INDEX IF NOT EXISTS idx_services_user
  ON service_enquiries(user_id);

  CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id,read);

  CREATE INDEX IF NOT EXISTS idx_favourites_property
  ON favourites(property_id);
`);

const adminEmail=(process.env.ADMIN_EMAIL||'admin@microtechnique.local').toLowerCase(), adminPassword=process.env.ADMIN_PASSWORD||'ChangeThisAdminPassword!';
if(!db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail)) db.prepare('INSERT INTO users(name,email,password_hash,role,verified) VALUES(?,?,?,?,1)').run('Platform Admin',adminEmail,bcrypt.hashSync(adminPassword,12),'admin');
const adminId=db.prepare('SELECT id FROM users WHERE email=?').get(adminEmail).id;
if(!db.prepare('SELECT id FROM properties LIMIT 1').get()){
 const samples=[['SAMPLE • 3 BHK Apartment','buy','Apartment','Gujarat','Surat','Vesu',8500000,1450,3],['SAMPLE • Residential Plot','buy','Residential Plot','Gujarat','Surat','Pal Gam',4200000,1200,0],['SAMPLE • Office Space','rent','Office Space','Gujarat','Surat','Adajan',45000,900,0],['SAMPLE • 2 BHK Flat','rent','Apartment','Gujarat','Surat','Piplod',26000,1050,2]];
 const s=db.prepare("INSERT INTO properties(owner_id,title,purpose,category,state,city,locality,price,area,bhk,description,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'approved')"); samples.forEach(p=>s.run(adminId,p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],'Demonstration sample only. Not a verified real property.'));
}
// Safe schema migration: preserve existing property records.
const propertyColumns=db.prepare('PRAGMA table_info(properties)').all().map(c=>c.name);
if(!propertyColumns.includes('ownership_declaration')) db.exec('ALTER TABLE properties ADD COLUMN ownership_declaration INTEGER NOT NULL DEFAULT 0');

const addPropertyColumn=(name,sql)=>{const cols=db.prepare('PRAGMA table_info(properties)').all().map(c=>c.name);if(!cols.includes(name))db.exec(sql);};
addPropertyColumn('monthly_rent','ALTER TABLE properties ADD COLUMN monthly_rent INTEGER');
addPropertyColumn('security_deposit','ALTER TABLE properties ADD COLUMN security_deposit INTEGER');
addPropertyColumn('available_from','ALTER TABLE properties ADD COLUMN available_from TEXT');
addPropertyColumn('tenant_preference','ALTER TABLE properties ADD COLUMN tenant_preference TEXT');
addPropertyColumn('pg_gender','ALTER TABLE properties ADD COLUMN pg_gender TEXT');
addPropertyColumn('meals_included','ALTER TABLE properties ADD COLUMN meals_included INTEGER DEFAULT 0');
addPropertyColumn('room_type','ALTER TABLE properties ADD COLUMN room_type TEXT');
addPropertyColumn('sharing_type','ALTER TABLE properties ADD COLUMN sharing_type TEXT');

const clean=v=>String(v??'').trim(), auth=(req,res,next)=>req.session.user?next():res.status(401).json({error:'Please log in'}), roles=(...r)=>(req,res,next)=>r.includes(req.session.user?.role)?next():res.status(403).json({error:'Permission denied'}), admin=roles('admin','super_admin');
app.set('trust proxy',process.env.NODE_ENV==='production'?1:false); app.use(helmet({contentSecurityPolicy:false})); app.use(express.json({limit:'2mb'})); app.use(express.urlencoded({extended:false})); app.use(morgan('tiny')); app.use(rateLimit({windowMs:15*60*1000,limit:300,standardHeaders:true,legacyHeaders:false}));
app.use(session({store:new SQLiteStore({db:'sessions.sqlite',dir:dataDir}),secret:process.env.SESSION_SECRET||'development-only-secret-change-this-32chars',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*86400000}}));
app.use(express.static(path.join(__dirname,'..','public')));
app.get('/api/health',(q,s)=>s.json({ok:true,service:'Microtechnique Buildtech API'})); 
app.get('/api/me',(q,s)=>s.json({user:q.session.user||null}));

// ==========================================
// PURCHASE REQUEST SYSTEM - SAFE MIGRATION
// ==========================================
db.exec(`
CREATE TABLE IF NOT EXISTS purchase_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  property_id INTEGER NOT NULL REFERENCES properties(id),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  owner_approval TEXT NOT NULL DEFAULT 'pending',
  admin_approval TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_purchase_owner
ON purchase_requests(owner_id, status);

CREATE INDEX IF NOT EXISTS idx_purchase_buyer
ON purchase_requests(buyer_id, created_at);

CREATE INDEX IF NOT EXISTS idx_purchase_property
ON purchase_requests(property_id, status);
`);
// BUY / RENT REQUEST TYPE MIGRATION
const requestColumns = db.prepare(
  "PRAGMA table_info(purchase_requests)"
).all();

if (!requestColumns.some(c => c.name === 'request_type')) {
  db.exec(`
    ALTER TABLE purchase_requests
    ADD COLUMN request_type TEXT NOT NULL DEFAULT 'buy'
  `);
} 

// BUYER: Submit Purchase Request

app.post('/api/purchase-requests', auth, roles('buyer'), (q, s) => {
  const propertyId = Number(q.body?.property_id);

  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    return s.status(400).json({ error: 'Invalid property ID' });
  }

  const property = db.prepare(`
    SELECT id, owner_id, title, status, purpose
    FROM properties
    WHERE id=?
  `).get(propertyId);

  if (!property || property.status !== 'approved') {
    return s.status(404).json({ error: 'Property is not available' });
  }

  // BUY OR RENT TYPE
  const requestType = String(
    q.body?.request_type || property.purpose || 'buy'
  ).toLowerCase().trim();

  if (!['buy', 'rent'].includes(requestType)) {
    return s.status(400).json({ error: 'Invalid request type' });
  }

  if (String(property.purpose).toLowerCase() !== requestType) {
    return s.status(400).json({
      error: 'Request type does not match property purpose'
    });
  }

  if (Number(property.owner_id) === Number(q.session.user.id)) {
    return s.status(403).json({
      error: 'You cannot request your own property'
    });
  }

  const existing = db.prepare(`
    SELECT id FROM purchase_requests
    WHERE buyer_id=? AND property_id=?
    AND status IN ('pending','approved')
  `).get(q.session.user.id, propertyId);

  if (existing) {
    return s.status(409).json({
      error: 'You already have an active request for this property'
    });
  }

  const result = db.prepare(`
    INSERT INTO purchase_requests
    (buyer_id, property_id, owner_id, request_type)
    VALUES (?, ?, ?, ?)
  `).run(
    q.session.user.id,
    property.id,
    property.owner_id,
    requestType
  );

  const requestId = Number(result.lastInsertRowid);
  const label = requestType === 'rent' ? 'Rental' : 'Purchase';

  createNotification(
    property.owner_id,
    'New ' + label + ' Request',
    'A buyer has submitted a ' + requestType +
    ' request for "' + property.title + '".'
  );

  const admins = db.prepare(`
    SELECT id FROM users
    WHERE role IN ('admin','super_admin')
  `).all();

  admins.forEach(a => createNotification(
    a.id,
    'New ' + label + ' Request',
    'A ' + requestType + ' request was submitted for "' +
    property.title + '".'
  ));

  createNotification(
    q.session.user.id,
    label + ' Request Submitted',
    'Your request for "' + property.title +
    '" has been sent to the owner and admin.'
  );

  return s.status(201).json({
    ok: true,
    id: requestId,
    request_type: requestType,
    message: label + ' request submitted successfully.'
  });
});


// OWNER: View requests for own properties

app.get('/api/owner/purchases', auth, roles('owner'), (q, s) => {
  const purchases = db.prepare(`
    SELECT
      pr.*,
      p.title AS property_title,
      p.price AS price,
      p.city AS property_city,
      u.name AS buyer_name,
      u.email AS buyer_email,
      u.phone AS buyer_phone
    FROM purchase_requests pr
    JOIN properties p ON p.id = pr.property_id
    JOIN users u ON u.id = pr.buyer_id
    WHERE pr.owner_id = ?
    ORDER BY pr.created_at DESC
  `).all(q.session.user.id);

  s.json({ purchases });
});

// OWNER: Approve or reject
app.patch('/api/owner/purchases/:id/approval', auth, roles('owner'), (q, s) => {
  const status = clean(q.body?.status).toLowerCase();

  if (!['approved', 'rejected'].includes(status)) {
    return s.status(400).json({ error: 'Invalid decision' });
  }

  const request = db.prepare(`
    SELECT
      pr.*,
      p.title AS property_title,
      p.purpose AS property_purpose
    FROM purchase_requests pr
    JOIN properties p ON p.id=pr.property_id
    WHERE pr.id=? AND pr.owner_id=?
  `).get(Number(q.params.id), q.session.user.id);

  if (!request) {
    return s.status(404).json({ error: 'Request not found' });
  }

  if (request.status !== 'pending' || request.owner_approval !== 'pending') {
    return s.status(409).json({
      error: 'This request has already been processed'
    });
  }

  const requestType = String(
    request.property_purpose || request.request_type || 'buy'
  ).toLowerCase().trim();

  if (!['buy', 'rent'].includes(requestType)) {
    return s.status(400).json({ error: 'Invalid property purpose' });
  }

  const label = requestType === 'rent' ? 'Rental' : 'Purchase';

  db.prepare(`
    UPDATE purchase_requests
    SET owner_approval=?,
        status=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    status,
    status === 'rejected' ? 'rejected' : 'pending',
    request.id
  );

  createNotification(
    request.buyer_id,
    label + ' Request Update',
    'The owner has ' + status + ' your ' + requestType +
      ' request for "' + request.property_title + '".'
  );

  const admins = db.prepare(`
    SELECT id FROM users
    WHERE role IN ('admin','super_admin')
  `).all();

  admins.forEach(a => createNotification(
    a.id,
    label + ' Request Update',
    'Owner has ' + status + ' ' + requestType +
      ' request #' + request.id + '.'
  ));

  s.json({
    ok: true,
    message: status === 'approved'
      ? 'Owner approval saved. Waiting for admin approval.'
      : label + ' request rejected.'
  });
});
// ADMIN: View all purchase requests
app.get('/api/admin/purchases', auth, admin, (q, s) => {
  const purchases = db.prepare(`
    SELECT
      pr.*,
      p.title AS property_title,
      p.price AS property_price,
      p.city AS property_city,
      buyer.name AS buyer_name,
      buyer.email AS buyer_email,
      buyer.phone AS buyer_phone,
      owner.name AS owner_name,
      owner.email AS owner_email
    FROM purchase_requests pr
    JOIN properties p ON p.id=pr.property_id
    JOIN users buyer ON buyer.id=pr.buyer_id
    JOIN users owner ON owner.id=pr.owner_id
    ORDER BY pr.created_at DESC
  `).all();

  s.json({ purchases });
});

// ADMIN: Final approval or rejection
app.patch('/api/admin/purchases/:id/approval', auth, admin, (q, s) => {
  const status = clean(q.body?.status).toLowerCase();

  if (!['approved', 'rejected'].includes(status)) {
    return s.status(400).json({ error: 'Invalid decision' });
  }

  const request = db.prepare(`
    SELECT
      pr.*,
      p.title AS property_title,
      p.status AS property_status,
      p.purpose AS property_purpose
    FROM purchase_requests pr
    JOIN properties p ON p.id=pr.property_id
    WHERE pr.id=?
  `).get(Number(q.params.id));

  if (!request) {
    return s.status(404).json({ error: 'Request not found' });
  }

  if (request.status !== 'pending' || request.admin_approval !== 'pending') {
    return s.status(409).json({
      error: 'This request has already been processed'
    });
  }

  if (status === 'approved' && request.owner_approval !== 'approved') {
    return s.status(409).json({
      error: 'Owner approval is required first'
    });
  }

  // Property purpose is the source of truth.
  const requestType = String(
    request.property_purpose || request.request_type || 'buy'
  ).toLowerCase().trim();

  if (!['buy', 'rent'].includes(requestType)) {
    return s.status(400).json({ error: 'Invalid property purpose' });
  }

  const label = requestType === 'rent' ? 'Rental' : 'Purchase';
  const newStatus = requestType === 'rent' ? 'rented' : 'sold';

  const finish = db.transaction(() => {
    if (status === 'rejected') {
      db.prepare(`
        UPDATE purchase_requests
        SET admin_approval='rejected',
            status='rejected',
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(request.id);

    } else {
      const update = db.prepare(`
        UPDATE properties
        SET status=?
        WHERE id=? AND status='approved'
      `).run(newStatus, request.property_id);

      if (update.changes !== 1) {
        throw new Error('Property is no longer available');
      }

      db.prepare(`
        UPDATE purchase_requests
        SET admin_approval='approved',
            status='approved',
            updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `).run(request.id);
    }
  });

  try {
    finish();
  } catch (e) {
    return s.status(409).json({ error: e.message });
  }

  createNotification(
    request.buyer_id,
    status === 'approved'
      ? label + ' Request Approved'
      : label + ' Request Rejected',
    status === 'approved'
      ? 'Owner and admin have approved your ' + requestType +
        ' request for "' + request.property_title + '".'
      : 'Admin has rejected your ' + requestType +
        ' request for "' + request.property_title + '".'
  );

  createNotification(
    request.owner_id,
    label + ' Request Updated',
    'Admin has ' + status + ' the ' + requestType +
      ' request for "' + request.property_title + '".'
  );

  s.json({
    ok: true,
    message: status === 'approved'
      ? 'Final approval completed. Property marked as ' + newStatus + '.'
      : label + ' request rejected.'
  });
});
app.post('/api/register',async(q,s)=>{
  const b=q.body||{};
  const role=clean(b.role||'buyer');
  const password=String(b.password||'');

  const allowed=[
    'buyer',
    'tenant',
    'owner',
    'builder',
    'channel_partner',
    'investor'
  ];

  const strongPassword =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

  if(!b.name || !b.email || !allowed.includes(role)){
    return s.status(400).json({
      error:'Valid name, email and account type are required.'
    });
  }

  if(!strongPassword.test(password)){
    return s.status(400).json({
      error:'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number and one special character.'
    });
  }

  try{
    const email=clean(b.email).toLowerCase();

    const id=Number(
      db.prepare(`
        INSERT INTO users(
          name,email,phone,password_hash,role,preferred_language
        ) VALUES(?,?,?,?,?,?)
      `).run(
        clean(b.name),
        email,
        clean(b.phone),
        await bcrypt.hash(password,12),
        role,
        'en'
      ).lastInsertRowid
    );

    q.session.user={
      id,
      name:clean(b.name),
      email,
      role
    };

    if(['owner','builder'].includes(role)){
      db.prepare(`
        INSERT INTO verification_requests(user_id,account_type,details)
        VALUES(?,?,?)
      `).run(
        id,
        role,
        'Verification pending; submit documents through the secure verification workflow.'
      );
    }

    s.status(201).json({user:q.session.user});

  }catch(e){
    s.status(409).json({
      error:'Email already registered or registration failed.'
    });
  }
});
app.post('/api/login',async(q,s)=>{const email=clean(q.body.email).toLowerCase(),u=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!u||!(await bcrypt.compare(String(q.body.password||''),u.password_hash)))return s.status(401).json({error:'Invalid email or password'});if(u.status!=='active')return s.status(403).json({error:'Account suspended'});q.session.user={id:u.id,name:u.name,email:u.email,role:u.role,verified:!!u.verified};s.json({user:q.session.user});});
app.post('/api/logout',(q,s)=>q.session.destroy(()=>s.json({ok:true})));


app.get('/api/properties',(q,s)=>{
  let sql = `
    SELECT p.*,u.name lister,u.role lister_role
    FROM properties p
    JOIN users u ON u.id=p.owner_id
WHERE (
  p.status='approved'
  OR (
    p.status='rented'
    AND p.purpose='rent'
  )
)  `;

  let a = [];

  const filters = {
    purpose:'p.purpose',
    category:'p.category',
    state:'p.state',
    district:'p.district',
    city:'p.city',
    village:'p.village',
    locality:'p.locality',
    pincode:'p.pincode'
  };

  for(const [k,col] of Object.entries(filters)){
    if(q.query[k]){
      sql += ` AND ${col} LIKE ?`;
      a.push('%'+clean(q.query[k])+'%');
    }
  }

  if(q.query.q){
    sql += `
      AND (
        p.title LIKE ?
        OR p.description LIKE ?
        OR p.locality LIKE ?
      )
    `;
    a.push(...Array(3).fill('%'+clean(q.query.q)+'%'));
  }

  const min = q.query.min === undefined ? null : Number(q.query.min);
  const max = q.query.max === undefined ? null : Number(q.query.max);
  const minArea = q.query.minArea === undefined ? null : Number(q.query.minArea);
  const maxArea = q.query.maxArea === undefined ? null : Number(q.query.maxArea);

  if(min !== null){
    if(!Number.isFinite(min)||min<0){
      return s.status(400).json({error:'Invalid minimum budget'});
    }
    sql += ' AND p.price>=?';
    a.push(min);
  }

  if(max !== null){
    if(!Number.isFinite(max)||max<0){
      return s.status(400).json({error:'Invalid maximum budget'});
    }
    sql += ' AND p.price<=?';
    a.push(max);
  }

  if(minArea !== null){
    if(!Number.isFinite(minArea)||minArea<0){
      return s.status(400).json({error:'Invalid minimum area'});
    }
    sql += ' AND p.area>=?';
    a.push(minArea);
  }

  if(maxArea !== null){
    if(!Number.isFinite(maxArea)||maxArea<0){
      return s.status(400).json({error:'Invalid maximum area'});
    }
    sql += ' AND p.area<=?';
    a.push(maxArea);
  }

  if(min !== null && max !== null && min > max){
    return s.status(400).json({error:'Minimum budget cannot exceed maximum budget'});
  }

  if(minArea !== null && maxArea !== null && minArea > maxArea){
    return s.status(400).json({error:'Minimum area cannot exceed maximum area'});
  }

  if(q.query.bhk){
    const bhk = Number(q.query.bhk);
    if(!Number.isInteger(bhk)||bhk<=0){
      return s.status(400).json({error:'Invalid BHK'});
    }
    sql += ' AND p.bhk=?';
    a.push(bhk);
  }


  if(q.query.monthlyMin){sql+=' AND COALESCE(p.monthly_rent,p.price)>=?';a.push(Math.max(0,Number(q.query.monthlyMin)||0));}
  if(q.query.monthlyMax){sql+=' AND COALESCE(p.monthly_rent,p.price)<=?';a.push(Math.max(0,Number(q.query.monthlyMax)||0));}
  if(q.query.depositMax){sql+=' AND COALESCE(p.security_deposit,0)<=?';a.push(Math.max(0,Number(q.query.depositMax)||0));}
  if(q.query.furnishing){sql+=' AND p.furnishing LIKE ?';a.push('%'+clean(q.query.furnishing)+'%');}
  if(q.query.tenant_preference){sql+=' AND p.tenant_preference LIKE ?';a.push('%'+clean(q.query.tenant_preference)+'%');}
  if(q.query.pgGender){sql+=' AND p.pg_gender=?';a.push(clean(q.query.pgGender));}
  if(q.query.meals==='yes'){sql+=' AND p.meals_included=1';}
  if(q.query.roomType){sql+=' AND p.room_type=?';a.push(clean(q.query.roomType));}
  if(q.query.availableFrom){sql+=' AND (p.available_from IS NULL OR p.available_from<=?)';a.push(clean(q.query.availableFrom));}
 const countSql = sql.replace(
  /^\s*SELECT[\s\S]*?\s+FROM\s+/i,
  'SELECT COUNT(*) AS total FROM '
);

  const total = db.prepare(countSql).get(...a).total;

  const sort = {
    newest:'p.created_at DESC',
    low:'p.price ASC',
    high:'p.price DESC',
    area:'p.area DESC'
  }[q.query.sort] || 'p.featured DESC,p.created_at DESC';

  const page = Math.max(1,parseInt(q.query.page)||1);
  const limit = 12;
  const pages = Math.ceil(total/limit);
  const offset = (page-1)*limit;

  sql += ` ORDER BY ${sort} LIMIT ? OFFSET ?`;

  const properties = db.prepare(sql).all(...a,limit,offset);

  s.json({
    properties,
    pagination:{
      page,
      limit,
      total,
      pages
    }
  });
});


app.get('/api/properties/:id',(q,s)=>{
  const p=db.prepare(`
    SELECT p.*,u.name lister,u.role lister_role
    FROM properties p
    JOIN users u ON u.id=p.owner_id
    WHERE p.id=?
    AND (
      p.status='approved'
      OR (p.status='rented' AND p.purpose='rent')
    )
  `).get(q.params.id);

  p
    ? s.json({property:p})
    : s.status(404).json({error:'Property not found'});
});

app.post('/api/properties', auth, roles('owner','admin','super_admin'), (q, s) => {
  const b = q.body;

  if (
    !b.title ||
    !b.state ||
    !b.district ||
    !b.city ||
    !b.locality ||
    !b.pincode ||
    !Number.isFinite(Number(b.price)) ||
    Number(b.price) <= 0
  ) {
    return s.status(400).json({
      error: 'Please provide all required property details and a valid price.'
    });
  }

  if (b.ownership_declaration !== 'yes') {
    return s.status(400).json({
      error: 'Please confirm the ownership or legal authorisation declaration.'
    });
  }

  const reraApplicable = ['yes','true','1'].includes(String(b.rera_applicable||'').toLowerCase());

  if (reraApplicable && !String(b.rera_number || '').trim()) {
    return s.status(400).json({
      error: 'RERA registration number is required when RERA is applicable.'
    });
  }

  const reraNumber = reraApplicable ? clean(b.rera_number) : '';

  const id = Number(
    db.prepare(`
      INSERT INTO properties(
        owner_id, title, purpose, category, state, district, city,
        village, locality, pincode, address, price, area, bhk,
description, furnishing, amenities, rera_number,
rera_applicable, ownership_declaration, monthly_rent, security_deposit,
available_from, tenant_preference, pg_gender, meals_included, room_type, sharing_type
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)    `).run(
      q.session.user.id,
      clean(b.title),
      clean(b.purpose || 'buy'),
      clean(b.category || 'Apartment'),
      clean(b.state),
      clean(b.district),
      clean(b.city),
      clean(b.village),
      clean(b.locality),
      clean(b.pincode),
      clean(b.address),
      Number(b.price),
      Number(b.area) || null,
      Number(b.bhk) || null,
      clean(b.description),
      clean(b.furnishing),
      clean(b.amenities),
      reraNumber,
reraApplicable ? 1 : 0,
1,
Number(b.monthly_rent)||null,
Number(b.security_deposit)||null,
clean(b.available_from),
clean(b.tenant_preference),
clean(b.pg_gender),
b.meals_included==='yes'?1:0,
clean(b.room_type),
clean(b.sharing_type)
    ).lastInsertRowid
  );

  s.status(201).json({
    id,
    message: 'Property submitted for admin review'
  });
});

app.delete(
  '/api/properties/:id',
  auth,
  roles('owner', 'seller', 'builder', 'agent', 'admin'),
  (q, s) => {
    const propertyId = Number(q.params.id);
    const userId = Number(q.session.user.id);
    const userRole = q.session.user.role;

    if (!Number.isInteger(propertyId) || propertyId <= 0) {
      return s.status(400).json({ error: 'Invalid property ID' });
    }

    const property = db.prepare(
      'SELECT id, owner_id FROM properties WHERE id = ?'
    ).get(propertyId);

    if (!property) {
      return s.status(404).json({ error: 'Property not found' });
    }

    // Admin can delete any property.
    // Other property listers can delete only their own.
    if (
      userRole !== 'admin' &&
      Number(property.owner_id) !== userId
    ) {
      return s.status(403).json({
        error: 'You can delete only your own property'
      });
    }

    db.prepare(
      "UPDATE properties SET status = 'deleted' WHERE id = ?"
    ).run(propertyId);

    s.json({
      success: true,
      message: 'Property deleted successfully'
    });
  }
);


app.get('/api/my/properties', auth, (q, s) => {
  const user = q.session.user;

  if (user.role === 'buyer') {
    const properties = db.prepare(`
      SELECT p.*, pr.id AS purchase_request_id,
             pr.created_at AS purchase_date
      FROM purchase_requests pr
      JOIN properties p ON p.id=pr.property_id
      WHERE pr.buyer_id=? AND pr.status='approved'
      ORDER BY pr.updated_at DESC
    `).all(user.id);

    return s.json({ properties });
  }

  if (user.role === 'owner') {
    const properties = db.prepare(`
      SELECT * FROM properties
      WHERE owner_id=?
      ORDER BY created_at DESC
    `).all(user.id);

    return s.json({ properties });
  }

  return s.status(403).json({ error: 'Permission denied' });
});

app.post('/api/enquiries',auth,(q,s)=>{
  const b=q.body||{};

  const property=db.prepare(`
    SELECT id,owner_id,title
    FROM properties
    WHERE id=? AND status='approved'
  `).get(Number(b.property_id));

  if(!property){
    return s.status(404).json({error:'Property unavailable'});
  }

  const phone=clean(b.phone).replace(/\s+/g,'');

  if(!/^[0-9]{10}$/.test(phone)){
    return s.status(400).json({error:'Enter a valid 10 digit mobile number'});
  }

  const id=Number(db.prepare(`
    INSERT INTO enquiries(user_id,property_id,name,phone,message)
    VALUES(?,?,?,?,?)
  `).run(
    q.session.user.id,
    property.id,
    q.session.user.name,
    phone,
    clean(b.message)
  ).lastInsertRowid);

  if(property.owner_id!==q.session.user.id){
    createNotification(
      property.owner_id,
      'New Property Enquiry',
      'You received a new enquiry for "'+property.title+'". Please check your dashboard.'
    );
  }

  s.status(201).json({
    ok:true,
    id,
    message:'Enquiry submitted successfully'
  });
});

// BUYER: GET MY ENQUIRIES
app.get('/api/my-enquiries', auth, (q, s) => {
  try {
    const properties = db.prepare(`
      SELECT
        e.id AS enquiry_id,
        e.property_id,
        e.name AS enquiry_name,
        e.phone AS enquiry_phone,
        e.message AS enquiry_message,
        e.status AS enquiry_status,
        e.created_at AS enquiry_created_at,
        p.*
      FROM enquiries e
      JOIN properties p ON p.id = e.property_id
      WHERE e.user_id = ?
      ORDER BY e.id DESC
    `).all(q.session.user.id);

    s.json({
      ok: true,
      properties
    });
  } catch (error) {
    console.error('My Enquiries Error:', error);
    s.status(500).json({ error: 'Unable to load enquiries' });
  }
});


// OWNER: Edit own property

app.put('/api/owner/properties/:id',auth,roles('owner','builder'),(q,s)=>{
  const id=Number(q.params.id);
  const b=q.body||{};

  if(!Number.isInteger(id)||id<=0){
    return s.status(400).json({error:'Invalid property ID'});
  }

  const property=db.prepare(`
    SELECT * FROM properties
    WHERE id=? AND owner_id=?
  `).get(id,q.session.user.id);

  if(!property){
    return s.status(404).json({error:'Property not found'});
  }

  const value=(key)=>b[key]===undefined
    ? property[key]
    : b[key];

  const title=clean(value('title'));
  const state=clean(value('state'));
  const district=clean(value('district'));
  const city=clean(value('city'));
  const locality=clean(value('locality'));
  const pincode=clean(value('pincode'));
  const price=Number(value('price'));

  if(!title||!state||!district||!city||!locality||!pincode||
     !Number.isFinite(price)||price<=0){
    return s.status(400).json({
      error:'Valid title, location, pincode and price required'
    });
  }

  const reraApplicable=Number(value('rera_applicable'))===1 ||
    value('rera_applicable')===true;

  const reraNumber=reraApplicable
    ? clean(value('rera_number'))
    : '';

  if(reraApplicable&&!reraNumber){
    return s.status(400).json({
      error:'RERA registration number is required'
    });
  }

  db.prepare(`
    UPDATE properties SET
      title=?,purpose=?,category=?,state=?,district=?,city=?,
      village=?,locality=?,pincode=?,address=?,price=?,area=?,
      bhk=?,description=?,furnishing=?,amenities=?,
      rera_number=?,rera_applicable=?,
      status='pending'
    WHERE id=? AND owner_id=?
  `).run(
    title,
    clean(value('purpose')),
    clean(value('category')),
    state,
    district,
    city,
    clean(value('village')),
    locality,
    pincode,
    clean(value('address')),
    price,
    Number(value('area'))||null,
    Number(value('bhk'))||null,
    clean(value('description')),
    clean(value('furnishing')),
    clean(value('amenities')),
    reraNumber,
    reraApplicable?1:0,
    id,
    q.session.user.id
  );

  s.json({
    ok:true,
    message:'Property updated and sent for admin review'
  });
});

// OWNER: Delete own property


app.delete('/api/owner/properties/:id', auth, roles('owner','builder'), (q,s) => {
  const id = Number(q.params.id);
  const ownerId = Number(q.session.user.id);

  if (!Number.isInteger(id) || id <= 0) {
    return s.status(400).json({ error: 'Invalid property ID' });
  }

  const property = db.prepare(`
    SELECT id
    FROM properties
    WHERE id=? AND owner_id=?
  `).get(id, ownerId);

  if (!property) {
    return s.status(404).json({ error: 'Property not found' });
  }

  try {
    const permanentlyDelete = db.transaction(() => {
      const relatedTables = [
        'favourites',
        'enquiries',
        'visits',
        'featured_offers',
        'purchase_requests'
      ];

      for (const table of relatedTables) {
        db.prepare(
          `DELETE FROM ${table} WHERE property_id=?`
        ).run(id);
      }

      return db.prepare(`
        DELETE FROM properties
        WHERE id=? AND owner_id=?
      `).run(id, ownerId);
    });

    const result = permanentlyDelete();

    if (!result.changes) {
      return s.status(404).json({ error: 'Property not found' });
    }

    s.json({
      ok: true,
      message: 'Property permanently deleted'
    });

  } catch (err) {
    console.error('Property delete error:', err);
    s.status(500).json({
      error: 'Could not permanently delete property'
    });
  }
});

app.patch('/api/owner/properties/:id/restore', auth, (q, s, next) => {
  if (['owner', 'builder'].includes(q.session.user?.role)) {
    return next();
  }
  return s.status(403).json({
    error: 'Only property owners and builders can restore properties.'
  });
}, (q, s) => {  const id = Number(q.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return s.status(400).json({ error: 'Invalid property ID' });
  }

  const property = db.prepare(`
    SELECT id, status
    FROM properties
    WHERE id = ? AND owner_id = ?
  `).get(id, q.session.user.id);

  if (!property) {
    return s.status(404).json({ error: 'Property not found' });
  }

  if (property.status !== 'archived') {
    return s.status(400).json({
      error: 'Only archived properties can be restored'
    });
  }

  db.prepare(`
    UPDATE properties
    SET status = 'pending'
    WHERE id = ? AND owner_id = ?
  `).run(id, q.session.user.id);

  s.json({
    success: true,
    message: 'Property restored and sent for admin approval'
  });
});

app.get('/api/owner/properties',auth,roles('owner','builder'),(q,s)=>{
  const properties=db.prepare(
    'SELECT * FROM properties WHERE owner_id=? ORDER BY created_at DESC'
  ).all(q.session.user.id);

  s.json({properties});
});

// OWNER: VIEW SITE VISIT REQUESTS
app.get('/api/owner/visits',auth,roles('owner','builder'),(q,s)=>{
  const visits=db.prepare(`
    SELECT
      v.id,
      v.user_id,
      v.property_id,
      v.visit_date,
      v.message,
      v.status,
      v.created_at,
      p.title AS property_title,
      u.name AS customer_name,
      u.phone AS customer_phone
    FROM visits v
    JOIN properties p ON p.id=v.property_id
    JOIN users u ON u.id=v.user_id
    WHERE p.owner_id=?
    ORDER BY v.created_at DESC
  `).all(q.session.user.id);

  s.json({visits});
});


// OWNER: UPDATE SITE VISIT STATUS
app.patch('/api/owner/visits/:id/status',auth,roles('owner','builder'),(q,s)=>{
  const id=Number(q.params.id);
  const status=clean(q.body.status);

  if(!Number.isInteger(id)||id<=0){
    return s.status(400).json({error:'Invalid visit ID'});
  }

  if(!['confirmed','rejected','completed'].includes(status)){
    return s.status(400).json({error:'Invalid visit status'});
  }

  const visit=db.prepare(`
    SELECT v.id,v.user_id,p.title
    FROM visits v
    JOIN properties p ON p.id=v.property_id
    WHERE v.id=? AND p.owner_id=?
  `).get(id,q.session.user.id);

  if(!visit){
    return s.status(404).json({error:'Visit request not found'});
  }

  db.prepare(`
    UPDATE visits SET status=? WHERE id=?
  `).run(status,id);

  createNotification(
    visit.user_id,
    'Site Visit '+status.charAt(0).toUpperCase()+status.slice(1),
    'Your site visit request for "'+visit.title+'" is now '+status+'.'
  );

  s.json({ok:true,message:'Site visit status updated'});
});


app.get('/api/owner/enquiries',auth,roles('owner','builder'),(q,s)=>{
  const enquiries=db.prepare(`
    SELECT e.*,p.title AS property_title
    FROM enquiries e
    JOIN properties p ON p.id=e.property_id
    WHERE p.owner_id=?
    ORDER BY e.created_at DESC
  `).all(q.session.user.id);

  s.json({enquiries});
});


app.post('/api/visits',auth,(q,s)=>{
  const b=q.body||{};

  const property=db.prepare(`
    SELECT id,owner_id,title
    FROM properties
    WHERE id=? AND status='approved'
  `).get(Number(b.property_id));

  if(!property){
    return s.status(404).json({error:'Property unavailable'});
  }

  if(!clean(b.visit_date)){
    return s.status(400).json({error:'Visit date is required'});
  }

  const id=Number(db.prepare(`
    INSERT INTO visits(user_id,property_id,visit_date,message)
    VALUES(?,?,?,?)
  `).run(
    q.session.user.id,
    property.id,
    clean(b.visit_date),
    clean(b.message)
  ).lastInsertRowid);

  if(property.owner_id!==q.session.user.id){
    createNotification(
      property.owner_id,
      'New Site Visit Request',
      'A site visit has been requested for "'+property.title+'". Please check your dashboard.'
    );
  }

  s.status(201).json({
    ok:true,
    id,
    message:'Site visit requested successfully'
  });
});


// GET: Load user's favourite properties
app.get('/api/favourites', auth, (q, s) => {
  try {
    const properties = db.prepare(`
      SELECT p.*
      FROM favourites f
      JOIN properties p ON p.id = f.property_id
      WHERE f.user_id = ?
      ORDER BY f.rowid DESC
    `).all(q.session.user.id);

    return s.json({
      ok: true,
      properties
    });
  } catch (e) {
    console.error('Load favourites error:', e);
    return s.status(500).json({
      error: 'Unable to load favourites'
    });
  }
});


// POST: Add or Remove favourite property
app.post('/api/favourites/:id', auth, (q, s) => {
  try {
    const userId = q.session.user.id;
    const propertyId = Number(q.params.id);

    if (!Number.isInteger(propertyId) || propertyId <= 0) {
      return s.status(400).json({
        error: 'Invalid property ID'
      });
    }

    const property = db.prepare(`
      SELECT id FROM properties
      WHERE id = ? AND status = 'approved'
    `).get(propertyId);

    if (!property) {
      return s.status(404).json({
        error: 'Property unavailable'
      });
    }

    const existing = db.prepare(`
      SELECT user_id
      FROM favourites
      WHERE user_id = ? AND property_id = ?
    `).get(userId, propertyId);

    if (existing) {
      db.prepare(`
        DELETE FROM favourites
        WHERE user_id = ? AND property_id = ?
      `).run(userId, propertyId);

      return s.json({
        ok: true,
        saved: false,
        message: 'Removed from favourites'
      });
    }

    db.prepare(`
      INSERT INTO favourites (user_id, property_id)
      VALUES (?, ?)
    `).run(userId, propertyId);

    return s.json({
      ok: true,
      saved: true,
      message: 'Saved to favourites'
    });

  } catch (e) {
    console.error('Favourite update error:', e);
    return s.status(500).json({
      error: 'Unable to update favourite'
    });
  }
});
app.get('/api/favourites',auth,(q,s)=>s.json({properties:db.prepare('SELECT p.* FROM favourites f JOIN properties p ON p.id=f.property_id WHERE f.user_id=?').all(q.session.user.id)}));

// SUBMIT HOME LOAN APPLICATION
app.post('/api/loans',auth,(q,s)=>{
  const b=q.body||{};

  const loanAmount=Number(b.loan_amount);
  const income=Number(b.income);
  const propertyValue=Number(b.property_value);
  const tenure=Number(b.tenure_years||20);

  if(!Number.isFinite(loanAmount)||loanAmount<=0){
    return s.status(400).json({error:'Enter a valid loan amount'});
  }

  if(!Number.isFinite(income)||income<=0){
    return s.status(400).json({error:'Enter a valid monthly income'});
  }

  if(b.property_value!==undefined &&
     b.property_value!=='' &&
     (!Number.isFinite(propertyValue)||propertyValue<=0)){
    return s.status(400).json({error:'Enter a valid property value'});
  }

  if(!Number.isInteger(tenure)||tenure<1||tenure>40){
    return s.status(400).json({error:'Tenure must be between 1 and 40 years'});
  }

  const id=Number(db.prepare(`
    INSERT INTO loans(
      user_id,loan_amount,property_value,income,tenure_years
    ) VALUES(?,?,?,?,?)
  `).run(
    q.session.user.id,
    loanAmount,
    b.property_value===''||b.property_value===undefined?null:propertyValue,
    income,
    tenure
  ).lastInsertRowid);

  s.status(201).json({
    ok:true,
    id,
    message:'Loan enquiry submitted. This is not loan approval.'
  });
});


// USER: VIEW OWN LOAN APPLICATIONS
app.get('/api/my/loans',auth,(q,s)=>{
  const loans=db.prepare(`
    SELECT id,loan_amount,property_value,income,
           tenure_years,status,created_at
    FROM loans
    WHERE user_id=?
    ORDER BY created_at DESC
  `).all(q.session.user.id);

  s.json({loans});
});


// ADMIN: UPDATE LOAN APPLICATION STATUS

app.patch('/api/admin/loans/:id/status',auth,admin,(q,s)=>{
  const id=Number(q.params.id);
  const status=clean(q.body.status);

  const allowedStatuses=[
    'submitted',
    'under_review',
    'contacted',
    'approved',
    'rejected'
  ];

  if(!Number.isInteger(id)||id<=0){
    return s.status(400).json({error:'Invalid application ID'});
  }

  if(!allowedStatuses.includes(status)){
    return s.status(400).json({error:'Invalid application status'});
  }

  const loan=db.prepare(`
    SELECT id,user_id FROM loans WHERE id=?
  `).get(id);

  if(!loan){
    return s.status(404).json({error:'Loan application not found'});
  }

  db.prepare(`
    UPDATE loans SET status=? WHERE id=?
  `).run(status,id);

  db.prepare(`
    INSERT INTO audit_logs(admin_id,action,entity,entity_id)
    VALUES(?,?,?,?)
  `).run(
    q.session.user.id,
    'loan_'+status,
    'loan',
    id
  );

  createNotification(
    loan.user_id,
    'Loan Application '+status.replace('_',' ').toUpperCase(),
    'Your loan application status has been updated to: '+status.replace('_',' ')+'.'
  );

  s.json({
    ok:true,
    message:'Loan application status updated and notification sent'
  });
});

app.post('/api/services',auth,(q,s)=>{
  const b=q.body||{};

  if(!b.service||!b.name||!b.phone){
    return s.status(400).json({
      error:'Service, name and phone required'
    });
  }

  const phone=clean(b.phone).replace(/\s+/g,'');

  if(!/^[0-9]{10}$/.test(phone)){
    return s.status(400).json({
      error:'Enter a valid 10 digit mobile number'
    });
  }

  try{
    const id=Number(
      db.prepare(`
        INSERT INTO service_enquiries
        (user_id,service,name,phone,details)
        VALUES(?,?,?,?,?)
      `).run(
        q.session.user.id,
        clean(b.service),
        clean(b.name),
        phone,
        clean(b.details)
      ).lastInsertRowid
    );

    s.status(201).json({
      ok:true,
      id,
      message:'Service enquiry received successfully'
    });

  }catch(e){
    s.status(500).json({
      error:'Unable to submit service enquiry'
    });
  }
});


app.get('/api/dashboard',auth,(q,s)=>{
  const id=q.session.user.id;
  const role=q.session.user.role;

  const isOwner=['owner','builder'].includes(role);

  const properties=isOwner
    ? db.prepare(`
        SELECT COUNT(*) n
        FROM properties
        WHERE owner_id=?
      `).get(id).n
    : 0;

  const enquiries=isOwner
    ? db.prepare(`
        SELECT COUNT(*) n
        FROM enquiries e
        JOIN properties p ON p.id=e.property_id
        WHERE p.owner_id=?
      `).get(id).n
    : db.prepare(`
        SELECT COUNT(*) n
        FROM enquiries
        WHERE user_id=?
      `).get(id).n;

  const favourites=db.prepare(`
    SELECT COUNT(*) n
    FROM favourites
    WHERE user_id=?
  `).get(id).n;

  const visits=isOwner
    ? db.prepare(`
        SELECT COUNT(*) n
        FROM visits v
        JOIN properties p ON p.id=v.property_id
        WHERE p.owner_id=?
      `).get(id).n
    : db.prepare(`
        SELECT COUNT(*) n
        FROM visits
        WHERE user_id=?
      `).get(id).n;

  const unreadNotifications=db.prepare(`
    SELECT COUNT(*) n
    FROM notifications
    WHERE user_id=? AND read=0
  `).get(id).n;

  s.json({
    properties,
    enquiries,
    favourites,
    visits,
    unreadNotifications,
    role
  });
});

app.get('/api/my-properties', auth, roles('owner', 'admin', 'super_admin'), (q, s) => {
  const userId = Number(q.session.user.id);
  const role = q.session.user.role;

  const properties = role === 'admin' || role === 'super_admin'
    ? db.prepare(`
        SELECT *
        FROM properties
        ORDER BY created_at DESC
      `).all()
    : db.prepare(`
        SELECT *
        FROM properties
        WHERE owner_id=?
        ORDER BY created_at DESC
      `).all(userId);

  s.json({ properties });
});

app.get('/api/my/enquiries',auth,(q,s)=>s.json({enquiries:db.prepare('SELECT e.*,p.title FROM enquiries e LEFT JOIN properties p ON p.id=e.property_id WHERE e.user_id=? ORDER BY e.created_at DESC').all(q.session.user.id)}));

app.get('/api/admin/overview',auth,admin,(q,s)=>{
  const count=t=>db.prepare(
    `SELECT COUNT(*) n FROM ${t}`
  ).get().n;

  s.json({
    users:count('users'),
    properties:count('properties'),
    pending:count('properties'),
    enquiries:count('enquiries'),
    loans:count('loans'),
    pendingLoans:db.prepare(`
      SELECT COUNT(*) n FROM loans
      WHERE status IN ('submitted','under_review')
    `).get().n,
    services:count('service_enquiries'),
    notifications:count('notifications')
  });
});

app.get('/api/my-properties', auth, roles('owner', 'admin', 'super_admin'), (q, s) => {
  const userId = Number(q.session.user.id);
  const role = q.session.user.role;

  const properties = ['admin', 'super_admin'].includes(role)
    ? db.prepare(`
        SELECT *
        FROM properties
        ORDER BY id DESC
      `).all()
    : db.prepare(`
        SELECT *
        FROM properties
        WHERE owner_id = ?
        ORDER BY id DESC
      `).all(userId);

  s.json({ properties });
});

app.get('/api/admin/users',auth,admin,(q,s)=>s.json({users:db.prepare('SELECT id,name,email,phone,role,verified,status,created_at FROM users ORDER BY created_at DESC').all()}));
app.get('/api/admin/properties',auth,admin,(q,s)=>s.json({properties:db.prepare('SELECT p.*,u.name lister FROM properties p JOIN users u ON u.id=p.owner_id ORDER BY p.created_at DESC').all()}));

// ADMIN: View Owner and Builder Verification Requests
app.get('/api/admin/verifications', auth, admin, (q, s) => {
  const requests = db.prepare(`
    SELECT
      v.id,
      v.user_id,
      v.account_type,
      v.details,
      v.status,
      v.created_at,
      u.name,
      u.email,
      u.phone
    FROM verification_requests v
    JOIN users u ON u.id = v.user_id
    ORDER BY v.created_at DESC
  `).all();

  s.json({ requests });
});


// ADMIN: Approve or Reject Verification
app.patch('/api/admin/verifications/:id/status', auth, admin, (q, s) => {
  const id = Number(q.params.id);
  const status = String(q.body?.status || '').toLowerCase();

  if (!['approved', 'rejected'].includes(status)) {
    return s.status(400).json({
      error: 'Status must be approved or rejected.'
    });
  }

  const request = db.prepare(`
    SELECT id, user_id, account_type, status
    FROM verification_requests
    WHERE id = ?
  `).get(id);

  if (!request) {
    return s.status(404).json({
      error: 'Verification request not found.'
    });
  }

  if (!['owner', 'builder'].includes(request.account_type)) {
    return s.status(400).json({
      error: 'Invalid account type.'
    });
  }

  const update = db.transaction(() => {
    db.prepare(`
      UPDATE verification_requests
      SET status = ?
      WHERE id = ?
    `).run(status, id);

    db.prepare(`
      UPDATE users
      SET verified = ?
      WHERE id = ?
    `).run(status === 'approved' ? 1 : 0, request.user_id);

    db.prepare(`
      INSERT INTO audit_logs(admin_id, action, entity, entity_id)
      VALUES(?, ?, ?, ?)
    `).run(
      q.session.user.id,
      `verification_${status}`,
      'verification_requests',
      id
    );

    createNotification(
      request.user_id,
      `Verification ${status}`,
      status === 'approved'
        ? 'Your account verification has been approved.'
        : 'Your account verification request was rejected.'
    );
  });

  update();

  s.json({
    success: true,
    message: `Verification ${status} successfully.`
  });
});

app.post('/api/admin/properties/:id/status',auth,admin,(q,s)=>{
  const id=Number(q.params.id);
  const status=clean(q.body.status);

  if(!Number.isInteger(id)||id<=0){
    return s.status(400).json({error:'Invalid property ID'});
  }

  if(!['approved','rejected','pending','rented'].includes(status)){
  return s.status(400).json({error:'Invalid status'});
}

  const property=db.prepare(`
    SELECT id,owner_id,title
    FROM properties
    WHERE id=?
  `).get(id);

  if(!property){
    return s.status(404).json({error:'Property not found'});
  }

  db.prepare(`
    UPDATE properties SET status=? WHERE id=?
  `).run(status,id);

  db.prepare(`
    INSERT INTO audit_logs(admin_id,action,entity,entity_id)
    VALUES(?,?,?,?)
  `).run(
    q.session.user.id,
    'property_'+status,
    'property',
    id
  );

  const messages={
    approved:'Your property "'+property.title+'" has been approved and is now visible on the platform.',
    rejected:'Your property "'+property.title+'" was rejected. Please contact support for details.',
    pending:'Your property "'+property.title+'" is pending review.'
  };

  createNotification(
    property.owner_id,
    'Property '+status.charAt(0).toUpperCase()+status.slice(1),
    messages[status]
  );

  s.json({ok:true,message:'Property status updated and notification sent'});
});
app.get('/api/admin/enquiries',auth,admin,(q,s)=>s.json({enquiries:db.prepare('SELECT e.*,p.title FROM enquiries e LEFT JOIN properties p ON p.id=e.property_id ORDER BY e.created_at DESC').all()}));
app.get('/api/admin/loans',auth,admin,(q,s)=>s.json({loans:db.prepare('SELECT l.*,u.name,u.email FROM loans l JOIN users u ON u.id=l.user_id ORDER BY l.created_at DESC').all()}));
app.get('/api/admin/services',auth,admin,(q,s)=>s.json({services:db.prepare('SELECT * FROM service_enquiries ORDER BY created_at DESC').all()}));

// USER: GET OWN NOTIFICATIONS
app.get('/api/notifications',auth,(q,s)=>{
  const notifications=db.prepare(`
    SELECT id,title,message,read,created_at
    FROM notifications
    WHERE user_id=?
    ORDER BY created_at DESC
  `).all(q.session.user.id);

  s.json({notifications});
});


// USER: MARK ONE NOTIFICATION AS READ
app.patch('/api/notifications/:id/read',auth,(q,s)=>{
  const id=Number(q.params.id);

  if(!Number.isInteger(id)||id<=0){
    return s.status(400).json({error:'Invalid notification ID'});
  }

  const result=db.prepare(`
    UPDATE notifications
    SET read=1
    WHERE id=? AND user_id=?
  `).run(id,q.session.user.id);

  if(!result.changes){
    return s.status(404).json({error:'Notification not found'});
  }

  s.json({ok:true,message:'Notification marked as read'});
});


// USER: MARK ALL NOTIFICATIONS AS READ
app.patch('/api/notifications/read-all',auth,(q,s)=>{
  db.prepare(`
    UPDATE notifications
    SET read=1
    WHERE user_id=? AND read=0
  `).run(q.session.user.id);

  s.json({ok:true,message:'All notifications marked as read'});
});

// USER: VIEW OWN SERVICE ENQUIRIES
app.get('/api/my/services',auth,(q,s)=>{
  const services=db.prepare(`
    SELECT id,service,name,phone,details,status,created_at
    FROM service_enquiries
    WHERE user_id=?
    ORDER BY created_at DESC
  `).all(q.session.user.id);

  s.json({services});
});


// ADMIN: UPDATE SERVICE ENQUIRY STATUS

app.patch('/api/admin/services/:id/status',auth,admin,(q,s)=>{
  const id=Number(q.params.id);
  const status=clean(q.body.status);

  const allowedStatuses=[
    'new',
    'contacted',
    'in_progress',
    'completed',
    'rejected'
  ];

  if(!Number.isInteger(id)||id<=0){
    return s.status(400).json({error:'Invalid service enquiry ID'});
  }

  if(!allowedStatuses.includes(status)){
    return s.status(400).json({error:'Invalid service status'});
  }

  const service=db.prepare(`
    SELECT id,user_id,service
    FROM service_enquiries
    WHERE id=?
  `).get(id);

  if(!service){
    return s.status(404).json({error:'Service enquiry not found'});
  }

  db.prepare(`
    UPDATE service_enquiries SET status=? WHERE id=?
  `).run(status,id);

  db.prepare(`
    INSERT INTO audit_logs(admin_id,action,entity,entity_id)
    VALUES(?,?,?,?)
  `).run(
    q.session.user.id,
    'service_'+status,
    'service_enquiry',
    id
  );

  createNotification(
    service.user_id,
    'Service Request Update',
    'Your '+service.service+' service request status is now '+status.replace('_',' ')+'.'
  );

  s.json({
    ok:true,
    message:'Service enquiry status updated and notification sent'
  });
});


// Builder: project catalogue and inventory. Builders manage projects, not direct property posts.
app.get('/api/builder/projects',auth,roles('builder','admin','super_admin'),(q,s)=>{
 const rows=db.prepare(`SELECT bp.*, (SELECT COUNT(*) FROM project_inventory pi WHERE pi.project_id=bp.id) inventory_types
 FROM builder_projects bp WHERE (? IN ('admin','super_admin') OR bp.builder_id=?) ORDER BY bp.created_at DESC`)
 .all(q.session.user.role,q.session.user.id);
 s.json({projects:rows});
});
app.post('/api/builder/projects',auth,roles('builder'),(q,s)=>{
 const b=q.body||{};
 if(!clean(b.title)||!clean(b.city)||!clean(b.state)) return s.status(400).json({error:'Project title, state and city are required.'});
 const id=Number(db.prepare(`INSERT INTO builder_projects(builder_id,title,description,state,district,city,locality,project_type,rera_number)
 VALUES(?,?,?,?,?,?,?,?,?)`).run(q.session.user.id,clean(b.title),clean(b.description),clean(b.state),clean(b.district),clean(b.city),clean(b.locality),clean(b.project_type),clean(b.rera_number)).lastInsertRowid);
 s.status(201).json({id,message:'Project submitted for admin review.'});
});
app.post('/api/builder/projects/:id/inventory',auth,roles('builder'),(q,s)=>{
 const project=db.prepare('SELECT id FROM builder_projects WHERE id=? AND builder_id=?').get(q.params.id,q.session.user.id);
 if(!project)return s.status(404).json({error:'Project not found.'});
 const b=q.body||{};
 if(!clean(b.unit_type))return s.status(400).json({error:'Unit type is required.'});
 const id=Number(db.prepare(`INSERT INTO project_inventory(project_id,unit_type,total_units,available_units,price_from,area_from) VALUES(?,?,?,?,?,?)`)
 .run(project.id,clean(b.unit_type),Math.max(0,Number(b.total_units)||0),Math.max(0,Number(b.available_units)||0),Math.max(0,Number(b.price_from)||0),Math.max(0,Number(b.area_from)||0)).lastInsertRowid);
 s.status(201).json({id,message:'Inventory added.'});
});
app.get('/api/partner/referrals',auth,roles('channel_partner','admin','super_admin'),(q,s)=>{
 const rows=db.prepare(`SELECT * FROM partner_referrals WHERE (? IN ('admin','super_admin') OR partner_id=?) ORDER BY created_at DESC`).all(q.session.user.role,q.session.user.id);
 s.json({referrals:rows});
});
app.post('/api/partner/referrals',auth,roles('channel_partner'),(q,s)=>{
 const b=q.body||{};
 if(!clean(b.customer_name)||!clean(b.customer_phone))return s.status(400).json({error:'Customer name and phone are required.'});
 const id=Number(db.prepare(`INSERT INTO partner_referrals(partner_id,customer_name,customer_phone,interest,notes) VALUES(?,?,?,?,?)`)
 .run(q.session.user.id,clean(b.customer_name),clean(b.customer_phone),clean(b.interest),clean(b.notes)).lastInsertRowid);
 s.status(201).json({id,message:'Referral submitted to admin team.'});
});
app.get('/api/investor/enquiries',auth,roles('investor','admin','super_admin'),(q,s)=>{
 const rows=db.prepare(`SELECT * FROM investor_enquiries WHERE (? IN ('admin','super_admin') OR investor_id=?) ORDER BY created_at DESC`).all(q.session.user.role,q.session.user.id);
 s.json({enquiries:rows});
});
app.post('/api/investor/enquiries',auth,roles('investor'),(q,s)=>{
 const b=q.body||{};
 if(!clean(b.opportunity))return s.status(400).json({error:'Investment opportunity is required.'});
 const id=Number(db.prepare(`INSERT INTO investor_enquiries(investor_id,opportunity,budget,message) VALUES(?,?,?,?)`)
 .run(q.session.user.id,clean(b.opportunity),Math.max(0,Number(b.budget)||0),clean(b.message)).lastInsertRowid);
 s.status(201).json({id,message:'Investment enquiry submitted.'});
});

app.get('/api/partner/commissions',auth,roles('channel_partner'),(q,s)=>{
 s.json({commissions:db.prepare('SELECT * FROM partner_commissions WHERE partner_id=? ORDER BY created_at DESC').all(q.session.user.id)});
});
app.post('/api/admin/partner-commissions',auth,admin,(q,s)=>{
 const b=q.body||{},ref=db.prepare('SELECT id,partner_id FROM partner_referrals WHERE id=?').get(b.referral_id);
 const value=Math.max(0,Number(b.sale_value)||0),rate=Math.max(0,Math.min(100,Number(b.commission_rate)||0));
 if(!ref||!value||!rate)return s.status(400).json({error:'Valid referral, sale value and commission rate are required.'});
 const amount=Math.round(value*rate/100);
 const id=Number(db.prepare(`INSERT INTO partner_commissions(referral_id,partner_id,sale_value,commission_rate,commission_amount,approved_by)
 VALUES(?,?,?,?,?,?)`).run(ref.id,ref.partner_id,value,rate,amount,q.session.user.id).lastInsertRowid);
 s.json({id,commission_amount:amount,message:'Commission recorded as pending payout.'});
});
app.get('/api/admin/partner-commissions',auth,admin,(q,s)=>{
 s.json({commissions:db.prepare(`SELECT c.*,u.name partner_name,r.customer_name FROM partner_commissions c JOIN users u ON u.id=c.partner_id JOIN partner_referrals r ON r.id=c.referral_id ORDER BY c.created_at DESC`).all()});
});
app.patch('/api/admin/partner-commissions/:id/status',auth,admin,(q,s)=>{
 const status=clean(q.body.status);
 if(!['pending','approved','paid','rejected'].includes(status))return s.status(400).json({error:'Invalid commission status.'});
 const paid=status==='paid'?new Date().toISOString():null;
 const result=db.prepare('UPDATE partner_commissions SET status=?,paid_at=COALESCE(?,paid_at) WHERE id=?').run(status,paid,q.params.id);
 if(!result.changes)return s.status(404).json({error:'Commission not found.'});
 s.json({ok:true,message:'Commission status updated.'});
});

app.get('/api/admin/partners',auth,admin,(q,s)=>{
 s.json({referrals:db.prepare(`SELECT r.*,u.name partner_name,u.email partner_email FROM partner_referrals r JOIN users u ON u.id=r.partner_id ORDER BY r.created_at DESC`).all()});
});
app.get('/api/admin/investors',auth,admin,(q,s)=>{
 s.json({enquiries:db.prepare(`SELECT i.*,u.name investor_name,u.email investor_email FROM investor_enquiries i JOIN users u ON u.id=i.investor_id ORDER BY i.created_at DESC`).all()});
});
app.post('/api/admin/featured-offers',auth,admin,(q,s)=>{
 const b=q.body||{};
 const property=db.prepare(`SELECT id FROM properties WHERE id=? AND status='approved'`).get(b.property_id);
 if(!property)return s.status(404).json({error:'Approved property not found.'});
 const id=Number(db.prepare(`INSERT INTO featured_offers(property_id,discount_label,offer_price,starts_at,ends_at) VALUES(?,?,?,?,?)`)
 .run(property.id,clean(b.discount_label),Math.max(0,Number(b.offer_price)||0),clean(b.starts_at),clean(b.ends_at)).lastInsertRowid);
 s.status(201).json({id,message:'Featured offer created.'});
});

app.get('/api/featured-offers',(q,s)=>{
 const offers=db.prepare(`SELECT fo.*,p.title,p.price,p.city,p.locality FROM featured_offers fo JOIN properties p ON p.id=fo.property_id
 WHERE fo.active=1 AND p.status='approved' AND (fo.ends_at IS NULL OR fo.ends_at='' OR fo.ends_at>=date('now')) ORDER BY fo.created_at DESC`).all();
 s.json({offers});
});

// MY ENQUIRIES API — અહીં ઉમેરો
app.get('/api/my-enquiries', auth, (q, s) => {
  try {
    const properties = db.prepare(`
      SELECT
        e.id AS enquiry_id,
        e.property_id,
        e.name AS enquiry_name,
        e.phone AS enquiry_phone,
        e.message AS enquiry_message,
        e.status AS enquiry_status,
        e.created_at AS enquiry_created_at,
        p.*
      FROM enquiries e
      JOIN properties p ON p.id = e.property_id
      WHERE e.user_id = ?
      ORDER BY e.id DESC
    `).all(q.session.user.id);

    s.json({ ok: true, properties });
  } catch (error) {
    console.error('My Enquiries Error:', error);
    s.status(500).json({ error: 'Unable to load enquiries' });
  }
});

// આ બંને હંમેશાં છેલ્લે રહેવા જોઈએ
app.get('*',(q,s)=>s.sendFile(path.join(__dirname,'..','public','index.html')));
app.listen(PORT,()=>console.log(`Microtechnique Buildtech running at http://localhost:${PORT}`));
