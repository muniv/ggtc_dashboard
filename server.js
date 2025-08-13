const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const natural = require('natural');
const moment = require('moment');
const fs = require('fs');
const csvParser = require('csv-parser');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database initialization
const db = new sqlite3.Database('./traffic_data.db');

// Initialize database tables
db.serialize(() => {
  // 교통상황 테이블
  db.run(`CREATE TABLE IF NOT EXISTS traffic_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_message TEXT NOT NULL,
    summary TEXT,
    category TEXT,
    priority INTEGER,
    confidence REAL,
    location TEXT,
    coordinates TEXT,
    status TEXT DEFAULT 'unread',
    vms_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // VMS 메시지 템플릿
  db.run(`CREATE TABLE IF NOT EXISTS vms_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    template TEXT,
    usage_count INTEGER DEFAULT 0
  )`);

  // 통계 데이터
  db.run(`CREATE TABLE IF NOT EXISTS statistics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    category TEXT,
    location TEXT,
    count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// NLP 분류기 설정
const classifier = new natural.BayesClassifier();

// CSV 파일 감시 및 처리
let lastProcessedTime = new Date('2025-01-01'); // 초기값을 과거로 설정하여 모든 데이터 처리
const CSV_FILE_PATH = './data/incidents.csv';
let processedIds = new Set(); // 처리된 레코드 ID 추적

// 교통사고/돌발상황/그 외 분류 학습
const trainingData = [
  { text: '교통사고 발생', category: 'accident' },
  { text: '차량 추돌', category: 'accident' },
  { text: '승용차 사고', category: 'accident' },
  { text: '버스 추돌', category: 'accident' },
  { text: '오토바이 접촉', category: 'accident' },
  { text: '도로 정체', category: 'incident' },
  { text: '차량 고장', category: 'incident' },
  { text: '공사로 인한 차선 통제', category: 'incident' },
  { text: '화재 발생', category: 'incident' },
  { text: '낙하물', category: 'incident' },
  { text: '침수', category: 'incident' },
  { text: '일반 신고', category: 'other' },
  { text: '소음 신고', category: 'other' },
  { text: '질서유지', category: 'other' },
  { text: '환경오염', category: 'other' }
];

trainingData.forEach(data => {
  classifier.addDocument(data.text, data.category);
});

classifier.train();

// CSV 파일에서 데이터 읽기 및 처리
function processCSVData() {
  if (!fs.existsSync(CSV_FILE_PATH)) {
    console.log('CSV 파일이 존재하지 않습니다:', CSV_FILE_PATH);
    return;
  }

  const results = [];
  fs.createReadStream(CSV_FILE_PATH)
    .pipe(csvParser())
    .on('data', (data) => results.push(data))
    .on('end', () => {
      console.log(`CSV에서 ${results.length}개의 레코드를 읽었습니다.`);
      
      results.forEach((row, index) => {
        // 고유 ID 생성 (접수일시 + 위치 + 신고내용 해시)
        const uniqueId = `${row.접수일시}_${row.재난위치}_${row.신고내용?.substring(0, 20)}`;
        
        // 이미 처리된 레코드는 건너뛰기
        if (!processedIds.has(uniqueId)) {
          processedIds.add(uniqueId);
          
          setTimeout(() => {
            processIncidentFromCSV(row, uniqueId);
          }, index * 1000); // 1초 간격으로 처리
        }
      });
      
      lastProcessedTime = new Date();
    })
    .on('error', (error) => {
      console.error('CSV 파일 읽기 오류:', error);
    });
}

// CSV 데이터를 교통상황으로 변환
function processIncidentFromCSV(csvRow, uniqueId) {
  const message = `${csvRow.신고내용} (${csvRow.요청사유})`;
  const location = csvRow.재난위치;
  const coordinates = csvRow.경위도;
  
  // NLP 분석
  const category = classifyIncidentFromCSV(csvRow);
  const confidence = classifier.getClassifications(message)[0]?.value || 0.7;
  
  // 우선순위 결정
  const priority = determinePriorityFromCSV(csvRow, category);
  
  // 요약 생성
  const summary = generateSummaryFromCSV(csvRow, category);
  
  // VMS 메시지 추천
  const vmsMessage = generateVMSMessage(category, location);
  
  const query = `
    INSERT INTO traffic_incidents 
    (original_message, summary, category, priority, confidence, location, coordinates, vms_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  // 중복 확인 쿼리 먼저 실행
  const checkQuery = `SELECT COUNT(*) as count FROM traffic_incidents WHERE original_message = ? AND location = ?`;
  
  db.get(checkQuery, [message, location], (err, row) => {
    if (err) {
      console.error('중복 확인 오류:', err.message);
      return;
    }
    
    // 이미 존재하는 데이터면 건너뛰기
    if (row.count > 0) {
      console.log(`중복 데이터 건너뛰기: ${summary}`);
      return;
    }
    
    // 새로운 데이터만 삽입
    db.run(query, [message, summary, category, priority, confidence, location, coordinates, vmsMessage], function(err) {
      if (err) {
        console.error('CSV 데이터 저장 오류:', err.message);
        return;
      }
    
    const incident = {
      id: this.lastID,
      original_message: message,
      summary,
      category,
      priority,
      confidence,
      location,
      coordinates,
      vms_message: vmsMessage,
      status: 'active',
      created_at: new Date().toISOString()
    };
    
      console.log(`새로운 상황 등록: ${summary}`);
      
      // 실시간 업데이트
      io.emit('newIncident', incident);
    });
  });
}

// CSV 데이터 기반 분류 (교통사고/돌발상황/그 외)
function classifyIncidentFromCSV(csvRow) {
  const 재난종별 = csvRow.재난종별?.toLowerCase() || '';
  const 신고내용 = csvRow.신고내용?.toLowerCase() || '';
  const 요청사유 = csvRow.요청사유?.toLowerCase() || '';
  
  // 교통사고
  if (재난종별.includes('교통사고') || 신고내용.includes('사고') || 신고내용.includes('추돌') || 
      신고내용.includes('접촉') || 신고내용.includes('전복')) {
    return 'accident';
  }
  
  // 돌발상황 (차량고장, 정체, 공사, 화재, 침수, 낙하물 등)
  if (신고내용.includes('고장') || 신고내용.includes('견인') || 신고내용.includes('엔진') ||
      신고내용.includes('정체') || 신고내용.includes('혼잡') || 신고내용.includes('차단') ||
      신고내용.includes('공사') || 요청사유.includes('공사') || 
      신고내용.includes('화재') || 신고내용.includes('폭발') ||
      신고내용.includes('폭우') || 신고내용.includes('침수') || 재난종별.includes('기상') ||
      신고내용.includes('낙하물') || 신고내용.includes('유출')) {
    return 'incident';
  }
  
  // 그 외 (질서유지, 소음, 환경 등)
  return 'other';
}

// CSV 데이터 기반 우선순위 결정
function determinePriorityFromCSV(csvRow, category) {
  const 신고내용 = csvRow.신고내용?.toLowerCase() || '';
  const 요청사유 = csvRow.요청사유?.toLowerCase() || '';
  
  // 인명피해 관련 - 최고 우선순위
  if (요청사유.includes('인명') || 신고내용.includes('부상') || 신고내용.includes('구조')) {
    return 5;
  }
  
  // 화재, 폭발 등 긴급상황 - 최고 우선순위
  if (신고내용.includes('화재') || 신고내용.includes('폭발') || 신고내용.includes('유출')) {
    return 5;
  }
  
  // 교통사고 - 높은 우선순위
  if (category === 'accident') {
    return 4;
  }
  
  // 돌발상황 - 중간 우선순위
  if (category === 'incident') {
    return 3;
  }
  
  // 그 외 - 낮은 우선순위
  return 1;
}

// CSV 데이터 기반 요약 생성
function generateSummaryFromCSV(csvRow, category) {
  const location = csvRow.재난위치?.split(' ').slice(-2).join(' ') || '위치불명';
  const 재난종별 = csvRow.재난종별 || category;
  
  return `[${재난종별.toUpperCase()}] ${location} - ${csvRow.신고내용?.substring(0, 50)}...`;
}

// 접수일시 파싱
function parseIncidentTime(timeString) {
  if (!timeString || timeString.length !== 14) {
    return new Date();
  }
  
  const year = timeString.substring(0, 4);
  const month = timeString.substring(4, 6);
  const day = timeString.substring(6, 8);
  const hour = timeString.substring(8, 10);
  const minute = timeString.substring(10, 12);
  const second = timeString.substring(12, 14);
  
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}

// API Routes
app.get('/api/incidents', (req, res) => {
  const query = `
    SELECT * FROM traffic_incidents 
    WHERE status != 'resolved' 
    ORDER BY priority DESC, created_at DESC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/incidents', (req, res) => {
  const { message, location, coordinates } = req.body;
  
  // NLP 분석
  const category = classifier.classify(message);
  const confidence = classifier.getClassifications(message)[0].value;
  
  // 우선순위 결정 (교통사고/돌발상황/그 외)
  const priorityMap = {
    'accident': 5,    // 교통사고
    'incident': 3,    // 돌발상황
    'other': 1        // 그 외
  };
  
  const priority = priorityMap[category] || 1;
  
  // 요약 생성 (간단한 키워드 추출)
  const summary = generateSummary(message, category);
  
  // VMS 메시지 추천
  const vmsMessage = generateVMSMessage(category, location);
  
  const query = `
    INSERT INTO traffic_incidents 
    (original_message, summary, category, priority, confidence, location, coordinates, vms_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  
  db.run(query, [message, summary, category, priority, confidence, location, coordinates, vmsMessage], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    const incident = {
      id: this.lastID,
      original_message: message,
      summary,
      category,
      priority,
      confidence,
      location,
      coordinates,
      vms_message: vmsMessage,
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    // 실시간 업데이트
    io.emit('newIncident', incident);
    
    res.json(incident);
  });
});

app.put('/api/incidents/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const query = `UPDATE traffic_incidents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  
  db.run(query, [status, id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    
    io.emit('incidentUpdated', { id, status });
    res.json({ success: true });
  });
});

app.get('/api/statistics', (req, res) => {
  const { period = 'week', category } = req.query;
  
  let dateFilter = '';
  switch(period) {
    case 'day':
      dateFilter = "WHERE date(created_at) = date('now')";
      break;
    case 'week':
      dateFilter = "WHERE date(created_at) >= date('now', '-7 days')";
      break;
    case 'month':
      dateFilter = "WHERE date(created_at) >= date('now', '-1 month')";
      break;
  }
  
  if (category) {
    dateFilter += dateFilter ? ` AND category = '${category}'` : `WHERE category = '${category}'`;
  }
  
  const query = `
    SELECT 
      category,
      location,
      COUNT(*) as count,
      date(created_at) as date
    FROM traffic_incidents 
    ${dateFilter}
    GROUP BY category, location, date(created_at)
    ORDER BY count DESC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/vms/send', (req, res) => {
  const { incidentId, message, location } = req.body;
  
  // VMS 발송 로직 (실제로는 외부 VMS 시스템과 연동)
  console.log(`VMS 발송: ${location} - ${message}`);
  
  // 사용 통계 업데이트
  const updateQuery = `UPDATE vms_templates SET usage_count = usage_count + 1 WHERE template = ?`;
  db.run(updateQuery, [message]);
  
  res.json({ success: true, message: 'VMS 메시지가 발송되었습니다.' });
});

// 헬퍼 함수들
function generateSummary(message, category) {
  const keywords = natural.WordTokenizer().tokenize(message);
  const importantKeywords = keywords.filter(word => 
    word.length > 2 && !['있습니다', '합니다', '입니다'].includes(word)
  ).slice(0, 5);
  
  return `[${category.toUpperCase()}] ${importantKeywords.join(', ')}`;
}

function generateVMSMessage(category, location) {
  const templates = {
    'accident': `${location} 교통사고 발생, 우회 바랍니다`,
    'breakdown': `${location} 차량고장, 서행 운전하세요`,
    'congestion': `${location} 정체중, 대중교통 이용 권장`,
    'construction': `${location} 공사중, 차선변경 주의`,
    'weather': `${location} 기상악화, 안전운전 하세요`
  };
  
  return templates[category] || `${location} 교통상황 주의`;
}

// Socket.IO 연결
io.on('connection', (socket) => {
  console.log('클라이언트 연결됨:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('클라이언트 연결 해제됨:', socket.id);
  });
});

// 메인 페이지 라우트
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CSV 파일 자동 처리 시작
processCSVData();

// 주기적으로 CSV 파일 확인 (30초마다)
setInterval(() => {
  processCSVData();
}, 30000);

// CSV 파일 수동 처리 API
app.post('/api/process-csv', (req, res) => {
  processCSVData();
  res.json({ success: true, message: 'CSV 파일 처리를 시작했습니다.' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행중입니다.`);
  console.log('CSV 파일 자동 처리가 시작되었습니다.');
});
