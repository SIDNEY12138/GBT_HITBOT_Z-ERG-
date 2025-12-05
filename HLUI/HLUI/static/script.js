// 全局变量
let autoRefreshInterval = null;
let modbusMonitorInterval = null;
let connectionMonitorInterval = null;
let digitalOutputMonitorInterval = null;
let currentDigitalOutputState = 0;
//let isAutoControlMode = true;
let digitalOutputHistory = [];
let modbusConnected = false;
let isReadingStatus = false; // 防止重复读取状态
let lastModbusCheckTime = null;
// 新增全局变量
let currentModbusIndicatorDigitalOutput = 1; // 当前选择的Modbus指示器数字输出端口





// 页面标签切换
function showTab(tabName) {
    // 隐藏所有标签内容
    const tabContents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabContents.length; i++) {
        tabContents[i].classList.remove("active");
    }
    
    // 移除所有标签的活跃状态
    const tabs = document.getElementsByClassName("nav-tab");
    for (let i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove("active");
    }
    
    // 显示选中的标签内容和设置标签为活跃状态
    document.getElementById(tabName).classList.add("active");
    event.currentTarget.classList.add("active");
}

// 更新时间显示
function updateTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    document.getElementById("currentTime").textContent = `${hours}:${minutes}:${seconds}`;
}

// 更新最后检查时间
function updateLastCheckTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    document.getElementById("lastCheckTime").textContent = `最后检查: ${timeString}`;
}

// 更新最后更新时间
function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    document.getElementById("lastUpdateTime").textContent = timeString;
}

// 自动刷新状态
function toggleAutoRefresh() {
    const interval = parseInt(document.getElementById("autoRefresh").value);
    
    // 清除现有的定时器
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    // 如果Modbus未连接，不启动自动刷新
    if (!modbusConnected && interval > 0) {
        showNotification('Modbus未连接，自动刷新已暂停', 'warning');
        return;
    }
    
    // 设置新的定时器
    if (interval > 0 && modbusConnected) {
        autoRefreshInterval = setInterval(() => {
            if (document.visibilityState === 'visible' && modbusConnected) {
                readAllStatus();
                updateDigitalOutputStatus();
            }
        }, interval);
        showNotification(`已开启自动刷新: ${interval}ms`, 'info');
    } else if (interval === 0) {
        showNotification('已关闭自动刷新', 'info');
    }
}

// 在window.onload函数中添加
window.onload = function() {
    updateTime();
    startConnectionStatusMonitor();
    startModbusStatusMonitor();
    startDigitalOutputMonitor();
    
    // 每秒更新一次时间
    setInterval(updateTime, 1000);
    
    // 初始检查Modbus状态和设置
    setTimeout(() => {
        checkConnectionStatus();
        getCurrentModbusIndicatorSetting(); // 获取当前Modbus指示器设置
    }, 1000);//1s后执行任务
    
    showNotification('机械臂控制面板已加载完成', 'success');
};

// 连接状态监控
function startConnectionStatusMonitor() {
    // 立即检查一次
    checkConnectionStatus();
    // 然后每3秒检查一次
    connectionMonitorInterval = setInterval(checkConnectionStatus, 3000);
}

// Modbus状态监控
function startModbusStatusMonitor() {
    // 每10秒检查一次Modbus状态
    modbusMonitorInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
            checkModbusStatus();
        }
    }, 10000);
}

// 数字输出状态监控
function startDigitalOutputMonitor() {
    // 每5秒检查一次数字输出状态
    digitalOutputMonitorInterval = setInterval(() => {
        if (document.visibilityState === 'visible') {
            updateDigitalOutputStatus();
        }
    }, 5000);
}

// 检查连接状态
async function checkConnectionStatus() {
    try {
        const response = await fetch("/get_connection_status");
        const data = await response.json();
        
        // 检查Modbus连接状态
        const modbusResponse = await fetch("/check_modbus_connected");
        const modbusData = await modbusResponse.json();
        
        modbusConnected = modbusData.modbus_connected;
        lastModbusCheckTime = modbusData.last_check;
        
        updateConnectionStatusDisplay(data, modbusData);
        updateLastCheckTime();
        
        // 根据Modbus连接状态更新UI
        updateUIForModbusStatus(modbusConnected);
        
    } catch (error) {
        console.error("检查连接状态失败:", error);
        modbusConnected = false;
        updateUIForModbusStatus(false);
        updateConnectionStatusDisplay({
            status: "检查失败",
            modbus_status: "网络错误",
            attempts: 0,
            max_attempts: 5
        }, {modbus_connected: false, modbus_status: "网络错误"});
    }
}

// 更新UI根据Modbus连接状态
// 修改updateUIForModbusStatus函数，只保留功能禁用逻辑，移除颜色/透明度变化
function updateUIForModbusStatus(connected) {
    const buttons = document.querySelectorAll('button:not(.connection-control)');
    const inputs = document.querySelectorAll('input, select');
    
    if (connected) {
        // Modbus已连接，启用所有控件
        buttons.forEach(btn => {
            if (!btn.classList.contains('status-check') && !btn.classList.contains('connection-control')) {
                btn.disabled = false;
                // 移除以下行
                // btn.style.opacity = '1';
                // btn.style.cursor = 'pointer';
            }
        });
        inputs.forEach(input => {
            if (!input.classList.contains('connection-control')) {
                input.disabled = false;
                // 移除以下行
                // input.style.opacity = '1';
            }
        });
        
        // 移除状态类切换
        // document.body.classList.remove('modbus-disconnected');
        // document.body.classList.add('modbus-connected');
        
        // 移除断开警告
        removeModbusDisconnectedWarning();
        
    } else {
        // Modbus未连接，禁用读写控件（但保留连接控制按钮）
        buttons.forEach(btn => {
            if (!btn.classList.contains('connection-control') && 
                !btn.classList.contains('status-check')) {
                btn.disabled = true;
                // 移除以下行
                // btn.style.opacity = '0.6';
                // btn.style.cursor = 'not-allowed';
            }
        });
        
        inputs.forEach(input => {
            if (!input.classList.contains('connection-control')) {
                input.disabled = true;
                // 移除以下行
                // input.style.opacity = '0.6';
            }
        });
        
        // 移除状态类切换
        // document.body.classList.remove('modbus-connected');
        // document.body.classList.add('modbus-disconnected');
        
        // 显示连接提示（可选：如果想保留提示但不改变颜色）
        showModbusDisconnectedWarning();
        
        // 如果自动刷新正在运行，暂停它
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }
}

// 显示Modbus断开警告
// 修改showModbusDisconnectedWarning函数的样式
function showModbusDisconnectedWarning() {
    // 移除现有的警告
    const existingWarning = document.getElementById('modbus-disconnected-warning');
    if (existingWarning) {
        existingWarning.remove();
    }
    
    const warning = document.createElement('div');
    warning.id = 'modbus-disconnected-warning';
    warning.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; background: #e74c3c; color: white; 
                   padding: 10px; text-align: center; z-index: 10000; font-weight: bold;">
            ⚠️ Modbus连接已断开，正在尝试重连... 所有读写操作已暂停
        </div>
    `;
    document.body.appendChild(warning);
    
    // 5秒后自动隐藏
    setTimeout(() => {
        const warning = document.getElementById('modbus-disconnected-warning');
        if (warning) {
            warning.style.transition = 'opacity 0.5s';
            warning.style.opacity = '0';
            setTimeout(() => warning.remove(), 500);
        }
    }, 5000);
}
// 移除Modbus断开警告
function removeModbusDisconnectedWarning() {
    const warning = document.getElementById('modbus-disconnected-warning');
    if (warning) {
        warning.style.transition = 'opacity 0.5s';
        warning.style.opacity = '0';
        setTimeout(() => warning.remove(), 500);
    }
}

// 更新连接状态显示
function updateConnectionStatusDisplay(data, modbusData) {
    const statusBadge = document.getElementById("connectionStatus");
    const modbusBadge = document.getElementById("modbusStatus");
    const digitalOutputBadge = document.getElementById("digitalOutputStatus");
    const reconnectInfo = document.getElementById("reconnectInfo");
    
    // 更新机械臂连接状态
    statusBadge.textContent = data.status;
    statusBadge.className = "status-badge";
    
    if (data.status === "已连接") {
        statusBadge.classList.add("status-connected");
        reconnectInfo.textContent = "";
    } else if (data.status.includes("失败") || data.status.includes("异常") || data.status.includes("丢失")) {
        statusBadge.classList.add("status-disconnected");
        reconnectInfo.textContent = `重连尝试: ${data.attempts}/${data.max_attempts}`;
    } else {
        statusBadge.classList.add("status-connecting");
    }
    
    // 更新Modbus状态显示
    modbusBadge.textContent = `Modbus: ${modbusData.modbus_status}`;
    modbusBadge.className = "status-badge";
    
    if (modbusData.modbus_connected) {
        modbusBadge.classList.add("status-modbus-connected");
    } else if (modbusData.modbus_status.includes("失败") || modbusData.modbus_status.includes("异常")) {
        modbusBadge.classList.add("status-modbus-disconnected");
    } else {
        modbusBadge.classList.add("status-modbus-warning");
    }
    
    // 更新数字输出状态显示
    updateDigitalOutputBadge(digitalOutputBadge);
}

// 更新数字输出状态徽章
function updateDigitalOutputBadge(badgeElement) {
    badgeElement.textContent = `DO: ${currentDigitalOutputState === 1 ? 'ON' : 'OFF'}`;
    badgeElement.className = "status-badge";
    
    if (currentDigitalOutputState === 1) {
        badgeElement.classList.add("status-do-on");
    } else {
        badgeElement.classList.add("status-do-off");
    }
}

// 检查Modbus状态
async function checkModbusStatus() {
    try {
        const response = await fetch("/check_modbus_status");
        const data = await response.json();
        
        updateModbusStatusDisplay(data.modbus_connected, data.modbus_status);
        updateLastCheckTime();
        
        return data.modbus_connected;
    } catch (error) {
        console.error("检查Modbus状态失败:", error);
        updateModbusStatusDisplay(false, '检查失败');
        return false;
    }
}

// 更新Modbus状态显示
function updateModbusStatusDisplay(connected, statusText) {
    const modbusStatus = document.getElementById("modbusStatus");
    
    modbusStatus.textContent = `Modbus: ${statusText}`;
    modbusStatus.className = "status-badge";
    
    if (connected) {
        modbusStatus.classList.add("status-modbus-connected");
    } else if (statusText.includes("异常") || statusText.includes("失败")) {
        modbusStatus.classList.add("status-modbus-disconnected");
    } else {
        modbusStatus.classList.add("status-modbus-warning");
    }
}

// 断开机械臂连接
async function disconnectRobot() {
    if (!confirm('确定要断开机械臂连接吗？')) {
        return;
    }
    
    try {
        const response = await fetch("/disconnect", { method: "POST" });
        const data = await response.json();
        
        if (data.success) {
            modbusConnected = false;
            updateUIForModbusStatus(false);
            showNotification("断开连接成功", 'success');
            // 更新状态显示
            setTimeout(checkConnectionStatus, 500);
        } else {
            showNotification(`断开连接失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

// 读取所有状态
async function readAllStatus() {
    // 如果Modbus未连接，不执行读取
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取状态', 'warning');
        return;
    }
    
    // 防止重复读取
    if (isReadingStatus) {
        return;
    }
    
    isReadingStatus = true;
    
    try {
        const response = await fetch("/read_all_status");
        const data = await response.json();
        
        if (data.success) {
            updateAllStatusDisplay(data.data);
            updateLastUpdateTime();
        } else {
            showNotification(`状态读取失败: ${data.message}`, 'error');
            // 如果读取失败，可能是Modbus连接问题
            if (data.message.includes("未连接")) {
                modbusConnected = false;
                updateUIForModbusStatus(false);
            }
        }
    } catch (error) {
        console.error("读取所有状态失败:", error);
        showNotification('状态读取失败: ' + error.message, 'error');
    } finally {
        isReadingStatus = false;
    }
}

// 安全获取值的辅助函数
function getSafeValue(obj, property) {
    if (!obj || obj[property] === undefined || obj[property] === null) {
        return null;
    }
    return obj[property];
}

// 更新所有状态显示
function updateAllStatusDisplay(statusData) {
    if (!statusData) {
        console.error('状态数据为空');
        showNotification('状态数据为空', 'error');
        return;
    }
    
    try {
        // 更新公共参数状态
        updateStatusValue("gripperIdValue", getSafeValue(statusData.gripper_id, 'value'));
        updateStatusValue("baudRateValue", getSafeValue(statusData.baud_rate, 'status_text') || getSafeValue(statusData.baud_rate, 'value'));
        updateStatusValue("gripperInitStatus", getSafeValue(statusData.gripper_init_status, 'status_text'));
        updateStatusValue("motorEnableValue", getSafeValue(statusData.motor_enable, 'status_text'));
        updateStatusValue("initDirectionValue", getSafeValue(statusData.init_direction, 'status_text'));
        updateStatusValue("autoInitValue", getSafeValue(statusData.auto_init, 'status_text'));
        updateStatusValue("rotationStopEnableValue", getSafeValue(statusData.rotation_stop_enable, 'status_text'));
        updateStatusValue("rotationStopSensitivityValue", getSafeValue(statusData.rotation_stop_sensitivity, 'value'));
        
        // 更新加持控制状态
        updateStatusValue("clampingPositionValue", getSafeValue(statusData.clamping_position, 'value'), 2, "mm");
        updateStatusValue("clampingSpeedValue", getSafeValue(statusData.clamping_speed, 'value'), 2, "mm/s");
        updateStatusValue("clampingStatusValue", getSafeValue(statusData.clamping_status, 'value'));
        updateStatusValue("clampingStatusText", getSafeValue(statusData.clamping_status, 'status_text'));
        updateStatusValue("clampingPositionFeedback", getSafeValue(statusData.clamping_position, 'value'), 2, "mm");
        updateStatusValue("clampingCurrentValue", getSafeValue(statusData.clamping_current, 'value'), 2, "A");
        // 更新加持控制状态
        updateStatusValue("clampingPositionValue", getSafeValue(statusData.clamping_position, 'value'), 2, "mm");
        updateStatusValue("clampingSpeedValue", getSafeValue(statusData.clamping_speed, 'value'), 2, "mm/s");
        // 注意：这里读取的是反馈值，不是设置值
        updateStatusValue("clampingCurrentValue", getSafeValue(statusData.clamping_current, 'value'), 2, "A");





        
        // 更新旋转控制状态
        updateStatusValue("rotationAngleValue", getSafeValue(statusData.rotation_angle, 'value'), 2, "度");
        updateStatusValue("rotationSpeedValue", getSafeValue(statusData.rotation_speed, 'value'), 2, "度/秒");
        updateStatusValue("rotationCurrentValue", getSafeValue(statusData.rotation_current, 'value'), 2, "A");
        updateStatusValue("rotationStatusValue", getSafeValue(statusData.rotation_status, 'value'));
        updateStatusValue("rotationStatusText", getSafeValue(statusData.rotation_status, 'status_text'));
        updateStatusValue("rotationAngleFeedback", getSafeValue(statusData.rotation_angle, 'value'), 2, "度");
        updateStatusValue("rotationSpeedFeedback", getSafeValue(statusData.rotation_speed, 'value'), 2, "度/秒");
        updateStatusValue("rotationCurrentFeedback", getSafeValue(statusData.rotation_current, 'value'), 2, "A");
        
        // 更新状态监控页面
        updateStatusValue("status_gripper_id", getSafeValue(statusData.gripper_id, 'value'));
        updateStatusValue("status_baud_rate", getSafeValue(statusData.baud_rate, 'status_text'));
        updateStatusValue("status_gripper_init_status", getSafeValue(statusData.gripper_init_status, 'status_text'));
        updateStatusValue("status_motor_enable", getSafeValue(statusData.motor_enable, 'status_text'));
        updateStatusValue("status_init_direction", getSafeValue(statusData.init_direction, 'status_text'));
        updateStatusValue("status_auto_init", getSafeValue(statusData.auto_init, 'status_text'));
        updateStatusValue("status_clamping_status", getSafeValue(statusData.clamping_status, 'status_text'));
        updateStatusValue("status_clamping_position", getSafeValue(statusData.clamping_position, 'value'), 2, "mm");
        updateStatusValue("status_clamping_speed", getSafeValue(statusData.clamping_speed, 'value'), 2, "mm/s");
        updateStatusValue("status_clamping_current", getSafeValue(statusData.clamping_current, 'value'), 2, "A");
        updateStatusValue("status_rotation_status", getSafeValue(statusData.rotation_status, 'status_text'));
        updateStatusValue("status_rotation_angle", getSafeValue(statusData.rotation_angle, 'value'), 2, "度");
        updateStatusValue("status_rotation_speed", getSafeValue(statusData.rotation_speed, 'value'), 2, "度/秒");
        updateStatusValue("status_rotation_current", getSafeValue(statusData.rotation_current, 'value'), 2, "A");
        updateStatusValue("status_rotation_stop_enable", getSafeValue(statusData.rotation_stop_enable, 'status_text'));
        updateStatusValue("status_rotation_stop_sensitivity", getSafeValue(statusData.rotation_stop_sensitivity, 'value'));
        
        // 更新数字输出状态
        updateDigitalOutputStatus();
        
    } catch (error) {
        console.error('更新状态显示时出错:', error);
        showNotification('更新状态显示时出错: ' + error.message, 'error');
    }
}

// 更新状态值显示
function updateStatusValue(elementId, value, decimals = 0, unit = "") {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    if (value === null || value === undefined || value === "") {
        element.textContent = "-";
        return;
    }
    
    if (typeof value === 'number') {
        if (decimals > 0) {
            element.textContent = value.toFixed(decimals) + (unit ? " " + unit : "");
        } else {
            element.textContent = value.toString() + (unit ? " " + unit : "");
        }
    } else {
        element.textContent = value + (unit ? " " + unit : "");
    }
}

// 修改setDigitalOutput函数，移除固定的端口号
async function setDigitalOutput(outputNumber, value) {
    try {
        const formData = new FormData();
        formData.append("output_number", outputNumber);
        formData.append("value", value);
        
        const response = await fetch("/set_digital_output", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            // 只有当设置的是当前指示器时才更新状态
            if (outputNumber === currentModbusIndicatorDigitalOutput) {
                currentDigitalOutputState = value;
            }
            const timestamp = new Date().toLocaleString();
            const reason = '自动控制';
            addToDigitalOutputHistory(value, timestamp, reason, outputNumber);
            updateDigitalOutputDisplay();
            showNotification(`数字输出${outputNumber}自动设置为${value === 1 ? 'ON' : 'OFF'}`, 'success');
            return true;
        } else {
            showNotification(`设置数字输出失败: ${data.message}`, 'error');
            return false;
        }
    } catch (error) {
        showNotification('设置数字输出失败: ' + error.message, 'error');
        return false;
    }
}






async function getDigitalOutput(outputNumber) {
    try {
        const response = await fetch(`/get_digital_output?output_number=${outputNumber}`);
        const data = await response.json();
        
        if (data.success) {
            currentDigitalOutputState = data.value;
            return data.value;
        } else {
            showNotification(`获取数字输出状态失败: ${data.message}`, 'error');
            return null;
        }
    } catch (error) {
        showNotification('获取数字输出状态失败: ' + error.message, 'error');
        return null;
    }
}

// 修改updateDigitalOutputStatus函数
async function updateDigitalOutputStatus() {
    try {
        const value = await getDigitalOutput(currentModbusIndicatorDigitalOutput);
        if (value !== null) {
            currentDigitalOutputState = value;
            updateDigitalOutputDisplay();
        }
        
        // 更新状态监控页面的显示
        const modbusStatus = document.getElementById("modbusStatus").textContent;
        const isModbusConnected = modbusStatus.includes("已连接");
        
        document.getElementById("status_current_do").textContent = value === 1 ? "ON" : "OFF";
        document.getElementById("status_do_control").textContent = "自动控制";
        document.getElementById("status_modbus").textContent = modbusStatus;
        document.getElementById("status_last_check").textContent = new Date().toLocaleTimeString();
        
    } catch (error) {
        console.error("更新数字输出状态失败:", error);
    }
}





// 修改 updateDigitalOutputDisplay 函数
function updateDigitalOutputDisplay() {
    // 更新头部状态显示
    const digitalOutputBadge = document.getElementById("digitalOutputStatus");
    updateDigitalOutputBadge(digitalOutputBadge);
    
    // 更新数字输出控制页面的显示
    document.getElementById("digitalOutputDisplay").textContent = 
        currentDigitalOutputState === 1 ? "ON" : "OFF";
    document.getElementById("controlModeDisplay").textContent = "自动控制";
    
    const modbusStatus = document.getElementById("modbusStatus").textContent;
    document.getElementById("modbusConnectionDisplay").textContent = modbusStatus;
    
    // 更新控制模式显示
    document.getElementById("currentControlMode").textContent = "自动控制";
    document.getElementById("currentControlMode").className = "control-mode-indicator control-mode-auto";
    
    // 更新最后状态信息
    const now = new Date();
    document.getElementById("digitalUpdateTime").textContent = now.toLocaleString();
    document.getElementById("digitalUpdateStatus").textContent = 
        `DO: ${currentDigitalOutputState === 1 ? 'ON' : 'OFF'}, Modbus: ${modbusConnected ? '已连接' : '未连接'}`;
}







// 修改历史记录函数，添加端口参数
function addToDigitalOutputHistory(state, timestamp, reason, outputNumber) {
    digitalOutputHistory.unshift({
        state: state,
        timestamp: timestamp,
        reason: reason,
        outputNumber: outputNumber
    });
    
    // 只保留最近50条记录
    if (digitalOutputHistory.length > 50) {
        digitalOutputHistory = digitalOutputHistory.slice(0, 50);
    }
}

// 显示通知
// 显示通知
function showNotification(message, type = 'info') {
    // 移除现有的通知
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => {
        if (document.body.contains(notification)) {
            document.body.removeChild(notification);
        }
    });
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: white;
        z-index: 1000;
        font-weight: 500;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transform: translateX(0);
        transition: all 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        backdrop-filter: blur(10px);
    `;
    
    // 设置不同通知类型的背景色
    const typeColors = {
        success: 'linear-gradient(135deg, #2ecc71, #27ae60)',
        error: 'linear-gradient(135deg, #e74c3c, #c0392b)',
        info: 'linear-gradient(135deg, #3498db, #2980b9)',
        warning: 'linear-gradient(135deg, #f39c12, #e67e22)'
    };
    
    notification.style.background = typeColors[type] || typeColors.info;
    
    // 添加图标
    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };
    
    notification.innerHTML = `
        <span style="margin-right: 8px; font-size: 16px;">${icons[type] || 'ℹ️'}</span>
        ${message}
    `;
    
    document.body.appendChild(notification);
    
    // 添加入场动画
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    // 3秒后自动消失
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 300);
    }, 3000);
    
    // 点击通知可立即关闭
    notification.addEventListener('click', () => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (document.body.contains(notification)) {
                document.body.removeChild(notification);
            }
        }, 300);
    });
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 格式化数字
function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined) return '-';
    return Number(value).toFixed(decimals);
}

// 工具函数：带超时的fetch请求
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

// 工具函数：重试机制
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }
            console.warn(`操作失败，第${attempt}次重试...`);
            await new Promise(resolve => setTimeout(resolve, delay * attempt));
        }
    }
}

// 增强的API调用函数
async function enhancedApiCall(url, options = {}) {
    return await retryOperation(async () => {
        const response = await fetchWithTimeout(url, options, 10000);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    });
}


// 设置Modbus连接状态指示器的数字输出端口
async function setModbusIndicatorDigitalOutput() {
    const outputNumber = document.getElementById("modbusIndicatorDigitalOutput").value;
    
    try {
        const formData = new FormData();
        formData.append("output_number", outputNumber);
        
        const response = await fetch("/set_modbus_indicator_digital_output", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            currentModbusIndicatorDigitalOutput = parseInt(outputNumber);
            updateModbusIndicatorDisplay();
            showNotification(data.message, 'success');
            
            // 立即更新状态显示
            updateDigitalOutputStatus();
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('设置失败: ' + error.message, 'error');
    }
}

// 获取当前Modbus指示器设置
async function getCurrentModbusIndicatorSetting() {
    try {
        const response = await fetch("/get_modbus_indicator_digital_output");
        const data = await response.json();
        
        if (data.success) {
            currentModbusIndicatorDigitalOutput = data.output_number;
            document.getElementById("modbusIndicatorDigitalOutput").value = currentModbusIndicatorDigitalOutput;
            updateModbusIndicatorDisplay();
            showNotification(`当前Modbus状态指示器为DO${currentModbusIndicatorDigitalOutput}`, 'info');
        }
    } catch (error) {
        showNotification('获取设置失败: ' + error.message, 'error');
    }
}

// 更新Modbus指示器显示
function updateModbusIndicatorDisplay() {
    document.getElementById("currentModbusIndicator").textContent = `DO${currentModbusIndicatorDigitalOutput}`;
    document.getElementById("status_modbus_indicator").textContent = `DO${currentModbusIndicatorDigitalOutput}`;
    
    // 更新头部状态显示的标签
    document.getElementById("digitalOutputLabel").textContent = `数字输出${currentModbusIndicatorDigitalOutput}:`;
}










// 公共参数相关函数
async function writeGripperId() {
    // 如果Modbus未连接，不执行写入
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const gripperId = document.getElementById("gripperId").value;
    if (!gripperId || gripperId < 1 || gripperId > 247) {
        showNotification("夹爪ID范围应为1-247", 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append("gripper_id", gripperId);
        
        const response = await fetch("/write_gripper_id", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
        if (data.success) {
            setTimeout(readGripperId, 500);
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function readGripperId() {
    // 如果Modbus未连接，不执行读取
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_gripper_id");
        const data = await response.json();
        
        if (data.success) {
            document.getElementById("gripperIdValue").textContent = data.value;
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function writeBaudRate() {
    // 如果Modbus未连接，不执行写入
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const baudRate = document.getElementById("baudRate").value;
    try {
        const formData = new FormData();
        formData.append("baud_rate", baudRate);
        
        const response = await fetch("/write_baud_rate", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
        if (data.success) {
            setTimeout(readBaudRate, 500);
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function readBaudRate() {
    // 如果Modbus未连接，不执行读取
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_baud_rate");
        const data = await response.json();
        
        if (data.success) {
            document.getElementById("baudRateValue").textContent = data.baud_value;
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function writeGripperInit() {
    // 如果Modbus未连接，不执行写入
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    if (!confirm('确定要执行夹爪初始化吗？')) {
        return;
    }
    
    try {
        const response = await fetch("/write_gripper_init", { method: "POST" });
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function writeMotorEnable() {
    // 如果Modbus未连接，不执行写入
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const enable = document.getElementById("motorEnable").value;
    try {
        const formData = new FormData();
        formData.append("enable", enable);
        
        const response = await fetch("/write_motor_enable", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
        if (data.success) {
            setTimeout(readMotorEnable, 500);
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function readMotorEnable() {
    // 如果Modbus未连接，不执行读取
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_motor_enable");
        const data = await response.json();
        
        if (data.success) {
            document.getElementById("motorEnableValue").textContent = data.value === 1 ? "使能" : "关闭";
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}


//增加高级设置部分
// 自动初始化设置
async function writeAutoInit() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const autoInit = document.getElementById("autoInit").value;
    try {
        const formData = new FormData();
        formData.append("auto_init", autoInit);
        
        const response = await fetch("/write_auto_init", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`自动初始化设置写入成功: ${autoInit === '0' ? '上电自动校准' : '手动校准'}`, 'success');
            // 写入成功后立即读取最新值确认
            setTimeout(readAutoInit, 500);
        } else {
            showNotification(`写入自动初始化设置失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('写入自动初始化设置失败: ' + error.message, 'error');
    }
}

async function readAutoInit() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_auto_init");
        const data = await response.json();
        
        if (data.success) {
            const statusText = data.value === 0 ? "上电自动校准" : "手动校准";
            document.getElementById("autoInitValue").textContent = statusText;
            // 同时更新下拉框显示
            document.getElementById("autoInit").value = data.value;
            showNotification(`自动初始化设置读取成功: ${statusText}`, 'success');
        } else {
            showNotification(`读取自动初始化设置失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('读取自动初始化设置失败: ' + error.message, 'error');
    }
}

// 保存参数设置
async function writeSaveParams() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const saveParams = document.getElementById("saveParams").value;
    try {
        const formData = new FormData();
        formData.append("save", saveParams);
        
        const response = await fetch("/write_save_params", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`参数保存${saveParams === '1' ? '成功' : '取消'}`, 'success');
        } else {
            showNotification(`保存参数后需重启检查: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('保存参数后需重启: ' + error.message, 'error');
    }
}

async function readSaveParams() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_save_params");
        const data = await response.json();
        
        if (data.success) {
            const statusText = data.value === 0 ? "未保存" : "已保存";
            // 更新显示
            document.getElementById("saveParams").value = data.value;
            showNotification(`保存参数设置读取成功: ${statusText}`, 'success');
        } else {
            showNotification(`读取保存参数设置失败read: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('读取保存参数设置失败read: ' + error.message, 'error');
    }
}



// 旋转堵停使能
async function writeRotationStopEnable() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const enable = document.getElementById("rotationStopEnable").value;
    try {
        const formData = new FormData();
        formData.append("enable", enable);
        
        const response = await fetch("/write_rotation_stop_enable", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`旋转堵停使能写入成功: ${enable === '1' ? '使能' : '不使能'}`, 'success');
            // 写入成功后立即读取最新值确认
            setTimeout(readRotationStopEnable, 500);
        } else {
            showNotification(`写入旋转堵停使能失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('写入旋转堵停使能失败: ' + error.message, 'error');
    }
}

async function readRotationStopEnable() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_rotation_stop_enable");
        const data = await response.json();
        
        if (data.success) {
            const statusText = data.value === 1 ? "使能" : "不使能";
            document.getElementById("rotationStopEnableValue").textContent = statusText;
            // 同时更新下拉框显示
            document.getElementById("rotationStopEnable").value = data.value;
            showNotification(`旋转堵停使能读取成功: ${statusText}`, 'success');
        } else {
            showNotification(`读取旋转堵停使能失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('读取旋转堵停使能失败: ' + error.message, 'error');
    }
}

// 旋转堵停灵敏度
async function writeRotationStopSensitivity() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const sensitivity = document.getElementById("rotationStopSensitivity").value;
    if (sensitivity < 0 || sensitivity > 100) {
        showNotification("灵敏度范围应为0-100", 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append("sensitivity", sensitivity);
        
        const response = await fetch("/write_rotation_stop_sensitivity", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`旋转堵停灵敏度写入成功: ${sensitivity}`, 'success');
            // 写入成功后立即读取最新值确认
            setTimeout(readRotationStopSensitivity, 500);
        } else {
            showNotification(`写入旋转堵停灵敏度失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('写入旋转堵停灵敏度失败: ' + error.message, 'error');
    }
}

async function readRotationStopSensitivity() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_rotation_stop_sensitivity");
        const data = await response.json();
        
        if (data.success) {
            document.getElementById("rotationStopSensitivityValue").textContent = data.value;
            // 同时更新输入框显示
            document.getElementById("rotationStopSensitivity").value = data.value;
            showNotification(`旋转堵停灵敏度读取成功: ${data.value}`, 'success');
        } else {
            showNotification(`读取旋转堵停灵敏度失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('读取旋转堵停灵敏度失败: ' + error.message, 'error');
    }
}


// 复位多圈转动值
async function writeResetRotation() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    if (!confirm('确定要复位多圈转动值吗？')) {
        return;
    }
    
    const reset = document.getElementById("resetRotation").value;
    try {
        const formData = new FormData();
        formData.append("reset", reset);
        
        const response = await fetch("/write_reset_rotation", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}


async function writeInitDirection() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const direction = document.getElementById("initDirection").value;
    try {
        const formData = new FormData();
        formData.append("direction", direction);
        
        const response = await fetch("/write_init_direction", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
        if (data.success) {
            setTimeout(readInitDirection, 500);
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function readInitDirection() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_init_direction");
        const data = await response.json();
        
        if (data.success) {
            const statusText = data.value === 0 ? "张开校准" : "闭合校准";
            document.getElementById("initDirectionValue").textContent = statusText;
            // 同时更新下拉框显示
            document.getElementById("initDirection").value = data.value;
            showNotification(`初始化方向读取成功: ${statusText}`, 'success');
        } else {
            showNotification(`读取初始化方向失败: ${data.message}`, 'error');
        }
    } catch (error) {
        showNotification('读取初始化方向失败: ' + error.message, 'error');
    }
}

// 加持控制相关函数
async function writeClampingPosition() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const position = document.getElementById("clampingPosition").value;
    if (position < 0 || position > 20) {
        showNotification("加持位置范围应为0-20mm", 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append("position", position);
        
        const response = await fetch("/write_clamping_position", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function writeClampingSpeed() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const speed = document.getElementById("clampingSpeed").value;
    if (speed < 1 || speed > 100) {
        showNotification("加持速度范围应为1-100mm/s", 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append("speed", speed);
        
        const response = await fetch("/write_clamping_speed", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function readClampingStatus() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法读取', 'warning');
        return;
    }
    
    try {
        const response = await fetch("/read_clamping_status");
        const data = await response.json();
        
        if (data.success) {
            document.getElementById("clampingStatusValue").textContent = data.value;
            document.getElementById("clampingStatusText").textContent = data.status_text;
            showNotification(`加持状态: ${data.status_text}`, 'info');
        } else {
            showNotification(data.message, 'error');
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

// 加持电流写入函数
async function writeClampingCurrent() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const current = parseFloat(document.getElementById("clampingCurrentSet").value);
    if (current < 0.1 || current > 0.5) {
        showNotification("加持电流范围应为0.1-0.5A", 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append("current", current);
        
        const response = await fetch("/write_clamping_current", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
        if (data.success) {
            // 写入成功后更新显示值
            document.getElementById("clampingCurrentSetValue").textContent = current.toFixed(2);
        }
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}





// 旋转控制相关函数
async function writeRotationAngle() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const angle = document.getElementById("rotationAngle").value;
    if (angle < -3600000 || angle > 3600000) {
        showNotification("旋转角度范围应为-3600000-3600000度", 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append("angle", angle);
        
        const response = await fetch("/write_rotation_angle", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

async function writeRotationSpeed() {
    if (!modbusConnected) {
        showNotification('Modbus未连接，无法写入', 'warning');
        return;
    }
    
    const speed = document.getElementById("rotationSpeed").value;
    if (speed < 1 || speed > 1080) {
        showNotification("旋转速度范围应为1-1080度/秒", 'error');
        return;
    }
    
    try {
        const formData = new FormData();
        formData.append("speed", speed);
        
        const response = await fetch("/write_rotation_speed", {
            method: "POST",
            body: formData
        });
        
        const data = await response.json();
        showNotification(data.message, data.success ? 'success' : 'error');
    } catch (error) {
        showNotification('操作失败: ' + error.message, 'error');
    }
}

// 键盘快捷键支持
document.addEventListener('keydown', function(event) {
    // Ctrl + R: 刷新状态
    if (event.ctrlKey && event.key === 'r') {
        event.preventDefault();
        readAllStatus();
    }
    // Ctrl + D: 断开连接
    if (event.ctrlKey && event.key === 'd') {
        event.preventDefault();
        disconnectRobot();
    }
    // Ctrl + M: 检查Modbus状态
    if (event.ctrlKey && event.key === 'm') {
        event.preventDefault();
        checkModbusStatus();
    }

    // Ctrl + 1-5: 切换标签页
    if (event.ctrlKey && event.key >= '1' && event.key <= '5') {
        event.preventDefault();
        const tabIndex = parseInt(event.key) - 1;
        const tabButtons = document.querySelectorAll('.nav-tab');
        if (tabButtons[tabIndex]) {
            tabButtons[tabIndex].click();
        }
    }
});

// 页面可见性变化时刷新状态
document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
        // 页面变为可见时立即检查状态
        setTimeout(() => {
            checkConnectionStatus();
            checkModbusStatus();
            readAllStatus();
            updateDigitalOutputStatus();
        }, 100);
    }
});

// 网络状态恢复时刷新状态
window.addEventListener('online', function() {
    showNotification('网络连接已恢复', 'success');
    setTimeout(() => {
        checkConnectionStatus();
        readAllStatus();
        updateDigitalOutputStatus();
    }, 500);
});

window.addEventListener('offline', function() {
    showNotification('网络连接已断开', 'error');
});

// 错误处理
window.addEventListener('error', function(event) {
    console.error('全局错误:', event.error);
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('未处理的Promise拒绝:', event.reason);
    showNotification('操作发生错误，请查看控制台', 'error');
});

// 页面卸载时清理资源
window.addEventListener('beforeunload', function() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    if (modbusMonitorInterval) {
        clearInterval(modbusMonitorInterval);
    }
    if (connectionMonitorInterval) {
        clearInterval(connectionMonitorInterval);
    }
    if (digitalOutputMonitorInterval) {
        clearInterval(digitalOutputMonitorInterval);
    }
});

// 批量测试所有功能
async function testAllFunctions() {
    if (!confirm('确定要测试所有功能吗？这可能需要一些时间。')) {
        return;
    }
    
    showNotification('开始测试所有功能...', 'info');
    
    const testFunctions = [
        { name: '读取夹爪ID', func: readGripperId },
        { name: '读取波特率', func: readBaudRate },
        { name: '读取电机使能', func: readMotorEnable },
        { name: '读取初始化方向', func: readInitDirection },
        { name: '读取自动初始化', func: readAutoInit },
        { name: '读取旋转堵停使能', func: readRotationStopEnable },
        { name: '读取旋转堵停灵敏度', func: readRotationStopSensitivity },
        { name: '读取夹爪初始化状态', func: readGripperInitStatus },
        { name: '读取加持状态', func: readClampingStatus },
        { name: '读取加持位置', func: readClampingPosition },
        { name: '读取加持速度', func: readClampingSpeed },
        { name: '读取加持电流', func: readClampingCurrent },
        { name: '读取旋转状态', func: readRotationStatus },
        { name: '读取旋转角度', func: readRotationAngle },
        { name: '读取旋转速度', func: readRotationSpeed },
        { name: '读取旋转电流', func: readRotationCurrent },
        { name: '读取数字输出状态', func: updateDigitalOutputStatus }
    ];
    
    for (let i = 0; i < testFunctions.length; i++) {
        const test = testFunctions[i];
        try {
            await test.func();
            // 在每个测试之间添加延迟，避免请求过于频繁
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            console.error(`${test.name}测试失败:`, error);
        }
    }
    
    showNotification('所有功能测试完成', 'success');
}

// 添加测试按钮到页面
function addTestButton() {
    const testButton = document.createElement('button');
    testButton.textContent = '🧪 测试所有功能';
    testButton.className = 'btn-warning';
    testButton.style.marginLeft = '10px';
    testButton.onclick = testAllFunctions;
    
    const monitorControls = document.querySelector('.monitor-controls');
    if (monitorControls) {
        monitorControls.appendChild(testButton);
    }
}

// 连接状态可视化指示器
function createConnectionIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'connectionIndicator';
    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #e74c3c;
        z-index: 9999;
        box-shadow: 0 0 10px rgba(231, 76, 60, 0.5);
        transition: all 0.3s ease;
    `;
    
    document.body.appendChild(indicator);
    return indicator;
}

// 更新连接指示器状态
function updateConnectionIndicator(status) {
    let indicator = document.getElementById('connectionIndicator');
    if (!indicator) {
        indicator = createConnectionIndicator();
    }
    
    if (status === '已连接') {
        indicator.style.background = '#2ecc71';
        indicator.style.boxShadow = '0 0 10px rgba(46, 204, 113, 0.5)';
    } else if (status.includes('失败') || status.includes('异常')) {
        indicator.style.background = '#e74c3c';
        indicator.style.boxShadow = '0 0 10px rgba(231, 76, 60, 0.5)';
    } else {
        indicator.style.background = '#f39c12';
        indicator.style.boxShadow = '0 0 10px rgba(243, 156, 18, 0.5)';
    }
}

// 修改checkConnectionStatus函数中的数字输出控制部分
async function checkConnectionStatus() {
    try {
        const response = await fetch("/get_connection_status");
        const data = await response.json();
        
        // 检查Modbus连接状态
        const modbusResponse = await fetch("/check_modbus_connected");
        const modbusData = await modbusResponse.json();
        
        modbusConnected = modbusData.modbus_connected;
        lastModbusCheckTime = modbusData.last_check;
        
        updateConnectionStatusDisplay(data, modbusData);
        updateLastCheckTime();
        
        // 根据Modbus连接状态自动设置选定的数字输出
        if (modbusConnected) {
            await setDigitalOutput(currentModbusIndicatorDigitalOutput, 1);
        } else {
            await setDigitalOutput(currentModbusIndicatorDigitalOutput, 0);
        }
        
        // 根据Modbus连接状态更新UI
        updateUIForModbusStatus(modbusConnected);
        
    } catch (error) {
        console.error("检查连接状态失败:", error);
        modbusConnected = false;
        updateUIForModbusStatus(false);
        updateConnectionStatusDisplay({
            status: "检查失败",
            modbus_status: "网络错误",
            attempts: 0,
            max_attempts: 5
        }, {modbus_connected: false, modbus_status: "网络错误"});
    }
}

// 页面完全加载后添加测试按钮
window.addEventListener('load', function() {
    setTimeout(addTestButton, 2000);
});

// 导出函数供其他脚本使用（如果需要）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showTab,
        updateTime,
        toggleAutoRefresh,
        checkConnectionStatus,
        checkModbusStatus,
        disconnectRobot,
        readAllStatus,
        showNotification,
        debounce,
        formatNumber,
        fetchWithTimeout,
        retryOperation,
        enhancedApiCall,
        testAllFunctions,
        setDigitalOutput,
        getDigitalOutput,
        updateDigitalOutputStatus
    };
}

console.log('机械臂控制面板JavaScript脚本加载完成');