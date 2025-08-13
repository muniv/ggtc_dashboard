// 전역 변수
let socket;
let incidents = [];
let selectedIncident = null;
let currentView = 'main';

// 초기화
document.addEventListener('DOMContentLoaded', function() {
    initializeSocket();
    loadIncidents();
    updateCurrentTime();
    setInterval(updateCurrentTime, 1000);
});

// Socket.IO 초기화
function initializeSocket() {
    socket = io();
    
    socket.on('connect', function() {
        console.log('서버에 연결되었습니다.');
    });
    
    socket.on('newIncident', function(incident) {
        incidents.unshift(incident);
        renderIncidents();
        showNotification('새로운 교통상황이 등록되었습니다.', 'info');
    });
    
    socket.on('incidentUpdated', function(data) {
        const incident = incidents.find(i => i.id === data.id);
        if (incident) {
            incident.status = data.status;
            renderIncidents();
        }
    });
}

// 현재 시간 업데이트
function updateCurrentTime() {
    const now = new Date();
    const timeString = now.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    document.getElementById('currentTime').textContent = timeString;
}

// 상황 목록 로드
async function loadIncidents() {
    try {
        const response = await fetch('/api/incidents');
        incidents = await response.json();
        renderIncidents();
    } catch (error) {
        console.error('상황 목록 로드 실패:', error);
        showNotification('상황 목록을 불러오는데 실패했습니다.', 'error');
    }
}

// 상황 목록 렌더링
function renderIncidents() {
    const container = document.getElementById('incidentsList');
    const activeCount = incidents.filter(i => i.status === 'active').length;
    
    document.getElementById('activeCount').textContent = activeCount;
    
    if (incidents.length === 0) {
        container.innerHTML = `
            <div class="list-group-item text-center text-muted py-4">
                <i class="fas fa-info-circle fa-2x mb-2"></i>
                <p>등록된 교통상황이 없습니다.</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = incidents.map(incident => `
        <div class="list-group-item incident-item priority-${incident.priority} ${selectedIncident?.id === incident.id ? 'selected' : ''}" 
             onclick="selectIncident(${incident.id})">
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <div class="d-flex align-items-center mb-2">
                        <span class="priority-indicator"></span>
                        <span class="badge category-badge category-${incident.category} me-2">
                            ${getCategoryName(incident.category)}
                        </span>
                        <span class="badge bg-${getStatusColor(incident.status)} me-2">
                            ${getStatusName(incident.status)}
                        </span>
                        <small class="text-muted">${formatTime(incident.created_at)}</small>
                    </div>
                    <h6 class="mb-1">${incident.summary}</h6>
                    <p class="mb-1 text-truncate">${incident.original_message}</p>
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-muted">
                            <i class="fas fa-map-marker-alt me-1"></i>
                            ${incident.location}
                        </small>
                        <div class="confidence-container">
                            <small class="text-muted me-2">신뢰도: ${Math.round(incident.confidence * 100)}%</small>
                            <div class="confidence-bar" style="width: 60px;">
                                <div class="confidence-fill confidence-${getConfidenceLevel(incident.confidence)}" 
                                     style="width: ${incident.confidence * 100}%"></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="ms-2">
                    <div class="btn-group-vertical btn-group-sm">
                        <button class="btn btn-outline-primary btn-sm" onclick="updateIncidentStatus(${incident.id}, 'checking')" 
                                ${incident.status === 'resolved' ? 'disabled' : ''} title="확인중">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn btn-outline-success btn-sm" onclick="updateIncidentStatus(${incident.id}, 'resolved')"
                                ${incident.status === 'resolved' ? 'disabled' : ''} title="해결완료">
                            <i class="fas fa-check"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

// 상황 선택
function selectIncident(id) {
    selectedIncident = incidents.find(i => i.id === id);
    renderIncidents();
    renderIncidentDetail();
    updateVMSControl();
}

// 상황 상세 정보 렌더링
function renderIncidentDetail() {
    const container = document.getElementById('incidentDetail');
    
    if (!selectedIncident) {
        container.innerHTML = '<p class="text-muted text-center">상황을 선택하세요</p>';
        return;
    }
    
    const incident = selectedIncident;
    container.innerHTML = `
        <div class="mb-3">
            <h6>원본 메시지</h6>
            <p class="border p-2 rounded bg-light">${incident.original_message}</p>
        </div>
        <div class="mb-3">
            <h6>분석 결과</h6>
            <div class="row">
                <div class="col-6">
                    <small class="text-muted">카테고리</small>
                    <p class="mb-1">
                        <span class="badge category-${incident.category}">
                            ${getCategoryName(incident.category)}
                        </span>
                    </p>
                </div>
                <div class="col-6">
                    <small class="text-muted">우선순위</small>
                    <p class="mb-1">
                        <span class="badge bg-${getPriorityColor(incident.priority)}">
                            ${incident.priority}/5
                        </span>
                    </p>
                </div>
            </div>
        </div>
        <div class="mb-3">
            <h6>위치 정보</h6>
            <p class="mb-1">
                <i class="fas fa-map-marker-alt text-danger me-1"></i>
                ${incident.location}
            </p>
            ${incident.coordinates ? `
                <small class="text-muted">좌표: ${incident.coordinates}</small>
            ` : ''}
        </div>
        <div class="mb-3">
            <h6>등록 시간</h6>
            <p class="mb-0 time-display">${formatDateTime(incident.created_at)}</p>
        </div>
    `;
}

// VMS 제어 패널 업데이트
function updateVMSControl() {
    const messageInput = document.getElementById('vmsMessage');
    const sendBtn = document.getElementById('sendVMSBtn');
    
    if (selectedIncident) {
        messageInput.value = selectedIncident.vms_message || '';
        sendBtn.disabled = false;
    } else {
        messageInput.value = '';
        sendBtn.disabled = true;
    }
}

// 상황 등록 모달 표시
function showAddIncidentModal() {
    const modal = new bootstrap.Modal(document.getElementById('addIncidentModal'));
    modal.show();
}

// 상황 등록
async function submitIncident() {
    const message = document.getElementById('incidentMessage').value;
    const location = document.getElementById('incidentLocation').value;
    const coordinates = document.getElementById('incidentCoordinates').value;
    
    if (!message || !location) {
        showNotification('필수 항목을 입력해주세요.', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/incidents', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                location,
                coordinates
            })
        });
        
        if (response.ok) {
            const modal = bootstrap.Modal.getInstance(document.getElementById('addIncidentModal'));
            modal.hide();
            document.getElementById('incidentForm').reset();
            showNotification('교통상황이 등록되었습니다.', 'success');
        } else {
            throw new Error('등록 실패');
        }
    } catch (error) {
        console.error('상황 등록 실패:', error);
        showNotification('상황 등록에 실패했습니다.', 'error');
    }
}

// 상황 상태 업데이트
async function updateIncidentStatus(id, status) {
    try {
        const response = await fetch(`/api/incidents/${id}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ status })
        });
        
        if (response.ok) {
            showNotification(`상황이 ${getStatusName(status)} 상태로 변경되었습니다.`, 'success');
        } else {
            throw new Error('상태 업데이트 실패');
        }
    } catch (error) {
        console.error('상태 업데이트 실패:', error);
        showNotification('상태 업데이트에 실패했습니다.', 'error');
    }
}

// VMS 메시지 발송
async function sendVMS() {
    if (!selectedIncident) return;
    
    const message = document.getElementById('vmsMessage').value;
    if (!message) {
        showNotification('VMS 메시지를 입력해주세요.', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/vms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                incidentId: selectedIncident.id,
                message,
                location: selectedIncident.location
            })
        });
        
        if (response.ok) {
            showNotification('VMS 메시지가 발송되었습니다.', 'success');
        } else {
            throw new Error('VMS 발송 실패');
        }
    } catch (error) {
        console.error('VMS 발송 실패:', error);
        showNotification('VMS 발송에 실패했습니다.', 'error');
    }
}

// 추천 VMS 메시지 사용
function useRecommendedVMS() {
    if (selectedIncident && selectedIncident.vms_message) {
        document.getElementById('vmsMessage').value = selectedIncident.vms_message;
    }
}

// 화면 전환
function toggleView() {
    const mainView = document.getElementById('mainView');
    const analysisView = document.getElementById('analysisView');
    const toggleBtn = document.querySelector('button[onclick="toggleView()"]');
    
    if (currentView === 'main') {
        mainView.style.display = 'none';
        analysisView.style.display = 'block';
        toggleBtn.innerHTML = '<i class="fas fa-tachometer-alt me-1"></i>관제 모드';
        currentView = 'analysis';
        loadStatistics();
    } else {
        mainView.style.display = 'block';
        analysisView.style.display = 'none';
        toggleBtn.innerHTML = '<i class="fas fa-chart-bar me-1"></i>분석 모드';
        currentView = 'main';
    }
}

// 통계 데이터 로드
async function loadStatistics() {
    const period = document.getElementById('periodSelect').value;
    const category = document.getElementById('categorySelect').value;
    
    try {
        const response = await fetch(`/api/statistics?period=${period}&category=${category}`);
        const data = await response.json();
        renderStatistics(data);
    } catch (error) {
        console.error('통계 로드 실패:', error);
        showNotification('통계 데이터를 불러오는데 실패했습니다.', 'error');
    }
}

// 통계 렌더링
function renderStatistics(data) {
    renderCategoryStats(data);
    renderLocationStats(data);
    renderChart(data);
}

// 카테고리별 통계
function renderCategoryStats(data) {
    const categoryData = {};
    data.forEach(item => {
        categoryData[item.category] = (categoryData[item.category] || 0) + item.count;
    });
    
    const container = document.getElementById('categoryStats');
    container.innerHTML = Object.entries(categoryData)
        .sort((a, b) => b[1] - a[1])
        .map(([category, count]) => `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="badge category-${category}">${getCategoryName(category)}</span>
                <strong>${count}건</strong>
            </div>
        `).join('');
}

// 구간별 통계
function renderLocationStats(data) {
    const locationData = {};
    data.forEach(item => {
        locationData[item.location] = (locationData[item.location] || 0) + item.count;
    });
    
    const container = document.getElementById('locationStats');
    container.innerHTML = Object.entries(locationData)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([location, count]) => `
            <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="text-truncate" style="max-width: 200px;">${location}</span>
                <strong>${count}건</strong>
            </div>
        `).join('');
}

// 차트 렌더링
function renderChart(data) {
    const ctx = document.getElementById('statisticsChart');
    if (!ctx) return;
    
    // 기존 차트 제거
    if (window.statisticsChart) {
        window.statisticsChart.destroy();
    }
    
    // 날짜별 데이터 집계
    const dateData = {};
    data.forEach(item => {
        dateData[item.date] = (dateData[item.date] || 0) + item.count;
    });
    
    const labels = Object.keys(dateData).sort();
    const values = labels.map(date => dateData[date]);
    
    window.statisticsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '발생 건수',
                data: values,
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// 통계 업데이트
function updateStatistics() {
    if (currentView === 'analysis') {
        loadStatistics();
    }
}

// CSV 처리 (서버에서 CSV 파일 읽기)
async function processCSVData() {
    try {
        const response = await fetch('/api/process-csv', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            showNotification(result.message, 'success');
        } else {
            throw new Error('CSV 처리 실패');
        }
    } catch (error) {
        console.error('CSV 처리 실패:', error);
        showNotification('CSV 처리에 실패했습니다.', 'error');
    }
}

// CSV 내보내기
async function exportCSV() {
    try {
        const period = document.getElementById('periodSelect').value;
        const category = document.getElementById('categorySelect').value;
        const response = await fetch(`/api/statistics?period=${period}&category=${category}`);
        const data = await response.json();
        
        const csv = convertToCSV(data);
        downloadCSV(csv, `traffic_statistics_${period}.csv`);
        showNotification('CSV 파일이 다운로드되었습니다.', 'success');
    } catch (error) {
        console.error('CSV 내보내기 실패:', error);
        showNotification('CSV 내보내기에 실패했습니다.', 'error');
    }
}

// CSV 변환
function convertToCSV(data) {
    const headers = ['날짜', '카테고리', '위치', '발생건수'];
    const rows = data.map(item => [
        item.date,
        getCategoryName(item.category),
        item.location,
        item.count
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
}

// CSV 다운로드
function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// 보고서 생성
function generateReport() {
    showNotification('보고서 생성 기능은 개발 중입니다.', 'info');
}

// 보조 정보 모달
function showMap() {
    showAuxiliaryModal('지도 정보', `
        <div class="text-center">
            <p>선택된 위치: ${selectedIncident ? selectedIncident.location : '위치 없음'}</p>
            <div class="bg-light p-4 rounded">
                <i class="fas fa-map fa-3x text-muted"></i>
                <p class="mt-2 text-muted">지도 연동 기능은 개발 중입니다.</p>
            </div>
        </div>
    `);
}

function showCCTV() {
    showAuxiliaryModal('CCTV 영상', `
        <div class="text-center">
            <div class="bg-dark p-4 rounded">
                <i class="fas fa-video fa-3x text-light"></i>
                <p class="mt-2 text-light">CCTV 연동 기능은 개발 중입니다.</p>
            </div>
        </div>
    `);
}

function showWeather() {
    showAuxiliaryModal('날씨 정보', `
        <div class="text-center">
            <div class="bg-info p-4 rounded text-white">
                <i class="fas fa-cloud-sun fa-3x"></i>
                <p class="mt-2">날씨 정보 연동 기능은 개발 중입니다.</p>
            </div>
        </div>
    `);
}

function showAuxiliaryModal(title, content) {
    document.getElementById('auxiliaryModalTitle').textContent = title;
    document.getElementById('auxiliaryModalBody').innerHTML = content;
    const modal = new bootstrap.Modal(document.getElementById('auxiliaryModal'));
    modal.show();
}

// 알림 표시
function showNotification(message, type = 'info') {
    const alertClass = {
        'success': 'alert-success',
        'error': 'alert-danger',
        'info': 'alert-info',
        'warning': 'alert-warning'
    }[type] || 'alert-info';
    
    const alert = document.createElement('div');
    alert.className = `alert ${alertClass} alert-dismissible fade show position-fixed`;
    alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(alert);
    
    setTimeout(() => {
        if (alert.parentNode) {
            alert.parentNode.removeChild(alert);
        }
    }, 5000);
}

// 유틸리티 함수들
function getCategoryName(category) {
    const names = {
        'accident': '교통사고',
        'incident': '돌발상황',
        'other': '그 외'
    };
    return names[category] || category;
}

function getStatusName(status) {
    const names = {
        'unread': '아직 안본거',
        'checking': '확인중',
        'resolved': '해결완료'
    };
    return names[status] || status;
}

function getStatusColor(status) {
    const colors = {
        'unread': 'danger',
        'checking': 'warning', 
        'resolved': 'success'
    };
    return colors[status] || 'secondary';
}

function getPriorityColor(priority) {
    const colors = {
        5: 'danger',
        4: 'warning',
        3: 'info',
        2: 'success',
        1: 'secondary'
    };
    return colors[priority] || 'secondary';
}

function getConfidenceLevel(confidence) {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium';
    return 'low';
}

function formatTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatDateTime(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}
