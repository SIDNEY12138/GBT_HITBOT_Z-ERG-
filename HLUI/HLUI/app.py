import os
import logging
import time
import struct
from fastapi import FastAPI, Form, Request, BackgroundTasks
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from datetime import datetime
from typing import Optional
import asyncio

# 导入原有的Modbus相关模块
from Agilebot.IR.A.arm import Arm
from Agilebot.IR.A.status_code import StatusCodeEnum
from Agilebot.IR.A.sdk_classes import SerialParams
from Agilebot.IR.A.sdk_types import ModbusChannel
from Agilebot.IR.A.sdk_types import ModbusParity
from Agilebot.IR.A.sdk_types import SignalType, SignalValue  # 新增导入

PORT = os.getenv("PORT", "8000")
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI()
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")

# 全局变量存储机械臂状态
arm_connection = None
slave_instance = None
arm_instance = None  # 新增：用于数字输出控制的机械臂实例
connection_status = "未连接"
modbus_status = "未连接"  # Modbus连接状态
reconnect_attempts = 0
max_reconnect_attempts = 5  # 最大重连次数
reconnect_interval = 10  # 重连间隔(秒)
last_modbus_check = None  # 最后Modbus检查时间
modbus_connected = False  # Modbus连接状态
last_modbus_check_success = False  # 上次Modbus检查是否成功
# 新增：存储选择的数字输出端口
selected_digital_output = 1  # 默认使用DO1作为modbus连接状态输出信号





class ModbusHelper:
    """Modbus通信辅助类"""
    
    @staticmethod
    def float_to_registers(float_value):
        """将浮点数转换为两个16位寄存器"""
        packed = struct.pack('>f', float_value)
        high_word = struct.unpack('>H', packed[:2])[0]
        low_word = struct.unpack('>H', packed[2:])[0]
        return [high_word, low_word]
    
    @staticmethod
    def registers_to_float(registers):
        """将两个16位寄存器转换为浮点数"""
        if len(registers) != 2:
            raise ValueError("需要2个寄存器值来转换为浮点数")
        
        high_word = registers[0]
        low_word = registers[1]
        packed = struct.pack('>HH', high_word, low_word)
        float_value = struct.unpack('>f', packed)[0]
        return float_value

def connect_robot():
    """连接机械臂"""
    global arm_connection, slave_instance, connection_status, modbus_status, reconnect_attempts
    try:
        arm_connection = Arm()
        ret = arm_connection.connect("10.27.1.254")
        
        if ret == StatusCodeEnum.OK:
            # 设置Modbus参数
            params = SerialParams(
                channel=ModbusChannel.WRIST_485_0, 
                ip="", 
                port=502, 
                baud=115200, 
                data_bit=8, 
                stop_bit=1, 
                parity=ModbusParity.NONE, 
                timeout=500
            )
            id, ret_code = arm_connection.modbus.set_parameter(params)
            
            if ret_code == StatusCodeEnum.OK:
                slave_instance = arm_connection.modbus.get_slave(ModbusChannel.WRIST_485_0, 1, 1)
                time.sleep(1)
                connection_status = "已连接"
                modbus_status = "已连接"
                reconnect_attempts = 0  # 重置重连计数
                return True, "机器人连接成功"
            else:
                connection_status = "连接失败"
                modbus_status = "Modbus参数设置失败"
                return False, f"设置Modbus参数失败: {ret_code.errmsg}"
        else:
            connection_status = "连接失败"
            modbus_status = "机械臂连接失败"
            return False, f"机器人连接失败: {ret.errmsg}"
            
    except Exception as e:
        connection_status = "连接异常"
        modbus_status = f"连接异常: {str(e)}"
        return False, f"连接过程中发生异常: {str(e)}"

def disconnect_robot():
    """断开机械臂连接"""
    global arm_connection, slave_instance, connection_status, modbus_status
    if arm_connection:
        arm_connection.disconnect()
    arm_connection = None
    slave_instance = None
    connection_status = "未连接"
    modbus_status = "未连接"
    return True, "已断开连接"

def set_digital_output(output_number: int, value: int):
    """设置数字输出状态"""
    global arm_instance
    
    try:
        if not arm_instance:
            # 初始化机械臂连接
            arm_instance = Arm()
            ret = arm_instance.connect("10.27.1.254")
            if ret != StatusCodeEnum.OK:
                return False, f"机械臂连接失败: {ret.errmsg}"
        
        # 设置数字输出
        signal_value = SignalValue.ON if value == 1 else SignalValue.OFF
        ret = arm_instance.signals.write(SignalType.DO, output_number, signal_value)
        
        if ret == StatusCodeEnum.OK:
            logger.info(f"数字输出{output_number}设置为{value}")
            return True, f"数字输出{output_number}设置为{value}"
        else:
            return False, f"设置数字输出失败: {ret.errmsg}"
            
    except Exception as e:
        return False, f"设置数字输出异常: {str(e)}"

def disconnect_arm():
    """断开机械臂连接（用于数字输出控制）"""
    global arm_instance
    if arm_instance:
        arm_instance.disconnect()
        arm_instance = None
        logger.info("数字输出控制连接已断开")

async def check_modbus_connection():
    """检查Modbus连接状态"""
    global modbus_status, slave_instance, last_modbus_check, modbus_connected, last_modbus_check_success
    
    if not slave_instance:
        modbus_status = "Modbus未初始化"
        modbus_connected = False
        last_modbus_check = datetime.now().isoformat()
        last_modbus_check_success = False
        return False
    
    try:
        # 尝试读取一个简单的寄存器来测试Modbus连接
        start_time = time.time()
        registers, status = slave_instance.read_holding_regs(0x80, 1)
        response_time = int((time.time() - start_time) * 1000)  # 计算响应时间
        
        last_modbus_check = datetime.now().isoformat()
        
        if status == StatusCodeEnum.OK:
            modbus_status = f"已连接 (响应: {response_time}ms)"
            modbus_connected = True
            last_modbus_check_success = True
            return True
        else:
            modbus_status = f"读取失败: {status.errmsg}"
            modbus_connected = False
            last_modbus_check_success = False
            return False
    except Exception as e:
        modbus_status = f"通信异常: {str(e)}"
        modbus_connected = False
        last_modbus_check = datetime.now().isoformat()
        last_modbus_check_success = False
        return False








async def check_connection_status():
    """检查连接状态"""
    global connection_status, modbus_status, modbus_connected
    
    while True:
        if connection_status == "已连接":
            # 检查Modbus连接状态
            modbus_ok = await check_modbus_connection()
            
            if modbus_ok:
                # Modbus已连接，设置选定的数字输出为1
                success, message = set_digital_output(selected_digital_output, 1)
                if success:
                    logger.info(f"Modbus已连接，数字输出{selected_digital_output}设置为ON")
                else:
                    logger.warning(f"设置数字输出{selected_digital_output}失败: {message}")
            else:
                # Modbus未连接，设置选定的数字输出为0
                success, message = set_digital_output(selected_digital_output, 0)
                if success:
                    logger.info(f"Modbus未连接，数字输出{selected_digital_output}设置为OFF")
                else:
                    logger.warning(f"设置数字输出{selected_digital_output}失败: {message}")
                
                connection_status = "Modbus连接异常"
                modbus_connected = False
        
        # 如果连接丢失且未达到最大重连次数，则尝试重连
        if connection_status in ["未连接", "连接失败", "连接异常", "Modbus连接异常", "连接丢失"]:
            global reconnect_attempts
            if reconnect_attempts < max_reconnect_attempts:
                logger.info(f"尝试重连机械臂，第 {reconnect_attempts + 1} 次")
                loop = asyncio.get_event_loop()
                success, message = await loop.run_in_executor(None, connect_robot)
                if success:
                    # 连接成功后立即检查Modbus状态
                    await check_modbus_connection()
                    reconnect_attempts = 0
                else:
                    logger.warning(f"重连失败: {message}")
                    reconnect_attempts += 1
            else:
                logger.warning(f"已达到最大重连次数 ({max_reconnect_attempts}次)，将在{reconnect_interval}秒后再次尝试")
                await asyncio.sleep(reconnect_interval)
                reconnect_attempts = 0  # 重置重连计数以便下次尝试
        
        # 每3秒检查一次连接状态
        await asyncio.sleep(3)

def write_float_registers(address: int, float_value: float):
    """写入浮点数到寄存器"""
    global modbus_connected
    
    if not slave_instance or not modbus_connected:
        return False, "Modbus未连接，无法写入"
    
    try:
        registers = ModbusHelper.float_to_registers(float_value)
        result = slave_instance.write_holding_regs(address, registers)
        return result == StatusCodeEnum.OK, f"写入浮点数到寄存器{address}: {float_value:.6f}"
    except Exception as e:
        modbus_connected = False  # 发生异常时标记为未连接
        return False, f"写入浮点数失败: {str(e)}"

def write_int_register(address: int, int_value: int):
    """写入整数到寄存器"""
    global modbus_connected
    
    if not slave_instance or not modbus_connected:
        return False, "Modbus未连接，无法写入"
    
    try:
        # 确保整数值在有效范围内
        if int_value < 0 or int_value > 65535:
            int_value = max(0, min(int_value, 65535))
        
        result = slave_instance.write_holding_regs(address, [int_value])
        return result == StatusCodeEnum.OK, f"写入整数到寄存器{address}: {int_value}"
    except Exception as e:
        modbus_connected = False  # 发生异常时标记为未连接
        return False, f"写入整数失败: {str(e)}"

def read_float_registers(address: int):
    """从寄存器读取浮点数"""
    global modbus_connected
    
    if not slave_instance or not modbus_connected:
        return False, "Modbus未连接，无法读取", None
    
    try:
        registers, status = slave_instance.read_holding_regs(address, 2)
        if status == StatusCodeEnum.OK and len(registers) == 2:
            float_value = ModbusHelper.registers_to_float(registers)
            return True, f"读取寄存器{address}成功", float_value
        else:
            modbus_connected = False  # 读取失败时标记为未连接
            return False, f"读取寄存器失败: {status}", None
    except Exception as e:
        modbus_connected = False  # 发生异常时标记为未连接
        return False, f"读取浮点数失败: {str(e)}", None

def read_int_register(address: int):
    """从寄存器读取整数"""
    global modbus_connected
    
    if not slave_instance or not modbus_connected:
        return False, "Modbus未连接，无法读取", None
    
    try:
        registers, status = slave_instance.read_holding_regs(address, 1)
        if status == StatusCodeEnum.OK and len(registers) >= 1:
            int_value = registers[0]
            return True, f"读取寄存器{address}成功", int_value
        else:
            modbus_connected = False  # 读取失败时标记为未连接
            return False, f"读取寄存器失败: {status}", None
    except Exception as e:
        modbus_connected = False  # 发生异常时标记为未连接
        return False, f"读取整数失败: {str(e)}", None



# 波特率映射字典
BAUD_RATE_MAP = {
    0: 9600,
    1: 19200,
    2: 38400,
    3: 57600,
    4: 115200,
    5: 153600,
    6: 256000
}

REVERSE_BAUD_MAP = {v: k for k, v in BAUD_RATE_MAP.items()}

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """主页面"""
    return templates.TemplateResponse("index.html", {
        "request": request,
        "connection_status": connection_status,
        "modbus_status": modbus_status,
        "port": PORT,
        "current_time": datetime.now().strftime("%H:%M:%S"),
        "baud_rate_map": BAUD_RATE_MAP
    })

@app.get("/get_connection_status")
async def get_connection_status():
    """获取当前连接状态"""
    return {
        "status": connection_status,
        "modbus_status": modbus_status,
        "last_modbus_check": last_modbus_check,
        "attempts": reconnect_attempts,
        "max_attempts": max_reconnect_attempts
    }

@app.post("/disconnect")
async def disconnect_endpoint():
    """断开机械臂连接"""
    success, message = disconnect_robot()
    return {"success": success, "message": message}

# 单独的Modbus状态检查接口
@app.get("/check_modbus_status")
async def check_modbus_status_endpoint():
    """单独检查Modbus连接状态"""
    modbus_ok = await check_modbus_connection()
    return {
        "modbus_connected": modbus_ok,
        "modbus_status": modbus_status,
        "last_check": last_modbus_check,
        "timestamp": datetime.now().isoformat()
    }

# 数字输出控制接口
@app.post("/set_digital_output")
async def set_digital_output_endpoint(output_number: int = Form(...), value: int = Form(...)):
    """手动设置数字输出"""
    if output_number < 1 or output_number > 16:
        return {"success": False, "message": "数字输出编号范围应为1-16"}
    
    if value not in [0, 1]:
        return {"success": False, "message": "输出值应为0或1"}
    
    success, message = set_digital_output(output_number, value)
    return {"success": success, "message": message}

@app.get("/get_digital_output")
async def get_digital_output_endpoint(output_number: int):
    """获取数字输出状态"""
    if output_number < 1 or output_number > 16:
        return {"success": False, "message": "数字输出编号范围应为1-16"}
    
    try:
        if not arm_instance:
            # 如果没有连接，尝试连接
            success, message = set_digital_output(output_number, 0)
            if not success:
                return {"success": False, "message": "无法连接到机械臂"}
        
        # 读取数字输出状态
        do_value, ret = arm_instance.signals.read(SignalType.DO, output_number)
        if ret == StatusCodeEnum.OK:
            status = 1 if do_value == SignalValue.ON else 0
            return {"success": True, "value": status, "status_text": "ON" if status == 1 else "OFF"}
        else:
            return {"success": False, "message": f"读取数字输出失败: {ret.errmsg}"}
            
    except Exception as e:
        return {"success": False, "message": f"读取数字输出异常: {str(e)}"}


@app.post("/set_modbus_indicator_digital_output")
async def set_modbus_indicator_digital_output(output_number: int = Form(...)):
    """设置用于Modbus连接状态指示的数字输出端口"""
    global selected_digital_output
    
    if output_number < 1 or output_number > 16:
        return {"success": False, "message": "数字输出编号范围应为1-16"}
    
    selected_digital_output = output_number
    logger.info(f"设置Modbus连接状态指示器为数字输出{output_number}")
    
    return {
        "success": True, 
        "message": f"已设置Modbus连接状态指示器为数字输出{output_number}"
    }

@app.get("/get_modbus_indicator_digital_output")
async def get_modbus_indicator_digital_output():
    """获取当前设置的Modbus连接状态指示数字输出端口"""
    return {
        "success": True, 
        "output_number": selected_digital_output
    }




    
# 公共部分读写接口
@app.post("/write_gripper_id")
async def write_gripper_id(gripper_id: int = Form(...)):
    """写入夹爪ID (地址0x80)"""
    if gripper_id < 1 or gripper_id > 247:
        return {"success": False, "message": "夹爪ID范围应为1-247"}
    
    success, message = write_int_register(0x80, gripper_id)
    return {"success": success, "message": message}

@app.get("/read_gripper_id")
async def read_gripper_id():
    """读取夹爪ID (地址0x80)"""
    success, message, value = read_int_register(0x80)
    return {"success": success, "message": message, "value": value}

@app.post("/write_baud_rate")
async def write_baud_rate(baud_rate: int = Form(...)):
    """写入夹爪波特率 (地址0x81)"""
    if baud_rate < 0 or baud_rate > 7:
        return {"success": False, "message": "波特率编号范围应为1-7"}
    
    success, message = write_int_register(0x81, baud_rate)
    return {"success": success, "message": message}

@app.get("/read_baud_rate")
async def read_baud_rate():
    """读取夹爪波特率 (地址0x81)"""
    success, message, value = read_int_register(0x81)
    baud_value = BAUD_RATE_MAP.get(value, "未知") if value is not None else None
    return {"success": success, "message": message, "value": value, "baud_value": baud_value}

@app.post("/write_gripper_init")
async def write_gripper_init(background_tasks: BackgroundTasks):
    """写入夹爪初始化 (地址0x0) - 写入1后0.5秒写0"""
    # 先写入1
    success, message = write_int_register(0x0, 1)
    if not success:
        return {"success": False, "message": message}
    
    # 后台任务0.5秒后写入0
    background_tasks.add_task(delayed_write_zero)
    return {"success": True, "message": "夹爪初始化命令已发送，0.5秒后自动复位"}

async def delayed_write_zero():
    """延迟写入0"""
    await asyncio.sleep(0.5)
    write_int_register(0x0, 0)

@app.post("/write_motor_enable")
async def write_motor_enable(enable: int = Form(...)):
    """写入电机使能 (地址0x16)"""
    if enable not in [0, 1]:
        return {"success": False, "message": "电机使能值应为0或1"}
    
    success, message = write_int_register(0x16, enable)
    return {"success": success, "message": message}

@app.get("/read_motor_enable")
async def read_motor_enable():
    """读取电机使能 (地址0x16)"""
    success, message, value = read_int_register(0x16)
    return {"success": success, "message": message, "value": value}

@app.post("/write_init_direction")
async def write_init_direction(direction: int = Form(...)):
    """写入初始化方向设置 (地址0x82)"""
    if direction not in [0, 1]:
        return {"success": False, "message": "初始化方向值应为0或1"}
    
    success, message = write_int_register(0x82, direction)
    return {"success": success, "message": message}

@app.get("/read_init_direction")
async def read_init_direction():
    """读取初始化方向设置 (地址0x82)"""
    success, message, value = read_int_register(0x82)
    return {"success": success, "message": message, "value": value}

@app.post("/write_auto_init")
async def write_auto_init(auto_init: int = Form(...)):
    """写入自动初始化设置 (地址0x83)"""
    if auto_init not in [0, 1]:
        return {"success": False, "message": "自动初始化值应为0或1"}
    
    success, message = write_int_register(0x83, auto_init)
    return {"success": success, "message": message}

@app.get("/read_auto_init")
async def read_auto_init():
    """读取自动初始化设置 (地址0x83)"""
    success, message, value = read_int_register(0x83)
    return {"success": success, "message": message, "value": value}

@app.post("/write_rotation_stop_enable")
async def write_rotation_stop_enable(enable: int = Form(...)):
    """写入旋转堵停使能 (地址0x9E)"""
    if enable not in [0, 1]:
        return {"success": False, "message": "旋转堵停使能值应为0或1"}
    
    success, message = write_int_register(0x9E, enable)
    return {"success": success, "message": message}

@app.get("/read_rotation_stop_enable")
async def read_rotation_stop_enable():
    """读取旋转堵停使能 (地址0x9E)"""
    success, message, value = read_int_register(0x9E)
    return {"success": success, "message": message, "value": value}

@app.post("/write_rotation_stop_sensitivity")
async def write_rotation_stop_sensitivity(sensitivity: int = Form(...)):
    """写入旋转堵停灵敏度 (地址0x9F)"""
    if sensitivity < 0 or sensitivity > 100:
        return {"success": False, "message": "灵敏度范围应为0-100"}
    
    success, message = write_int_register(0x9F, sensitivity)
    return {"success": success, "message": message}

@app.get("/read_rotation_stop_sensitivity")
async def read_rotation_stop_sensitivity():
    """读取旋转堵停灵敏度 (地址0x9F)"""
    success, message, value = read_int_register(0x9F)
    return {"success": success, "message": message, "value": value}

@app.post("/write_reset_rotation")
async def write_reset_rotation(reset: int = Form(...)):
    """写入复位多圈转动值 (地址0x8F)"""
    if reset not in [0, 1]:
        return {"success": False, "message": "复位值应为0或1"}
    
    success, message = write_int_register(0x8F, reset)
    return {"success": success, "message": message}

@app.post("/write_save_params")
async def write_save_params(save: int = Form(...)):
    """写入保存参数设置 (地址0x84)"""
    if save not in [0, 1]:
        return {"success": False, "message": "保存参数值应为0或1"}
    
    success, message = write_int_register(0x84, save)
    return {"success": success, "message": message}
    
@app.get("/read_save_params")
async def read_save_params():
    """读取保存参数设置 (地址0x84)"""
    success, message, value = read_int_register(0x84)
    status_text = "未保存" if value == 0 else "已保存" if value == 1 else "未知"
    return {"success": success, "message": message, "value": value, "status_text": status_text}





    
@app.get("/read_gripper_init_status")
async def read_gripper_init_status():
    """读取夹爪初始化状态 (地址0x40)"""
    success, message, value = read_int_register(0x40)
    status_text = {
        0: "未初始化",
        5: "初始化完成",
        None: "读取失败"
    }.get(value, f"初始化中({value})") if value is not None else "读取失败"
    
    return {"success": success, "message": message, "value": value, "status_text": status_text}

# 加持部分接口
@app.post("/write_clamping_position")
async def write_clamping_position(position: float = Form(...)):
    """写入加持位置 (地址2)"""
    if position < 0 or position > 20:
        return {"success": False, "message": "加持位置范围应为0-20mm"}
    
    success, message = write_float_registers(2, position)
    return {"success": success, "message": message}

@app.post("/write_clamping_speed")
async def write_clamping_speed(speed: float = Form(...)):
    """写入加持速度 (地址4)"""
    if speed < 1 or speed > 100:
        return {"success": False, "message": "加持速度范围应为1-100mm/s"}
    
    success, message = write_float_registers(4, speed)
    return {"success": success, "message": message}

@app.get("/read_clamping_status")
async def read_clamping_status():
    """读取夹持状态 (地址0x41)"""
    success, message, value = read_int_register(0x41)
    status_text = {
        0: "到位",
        1: "运动中",
        2: "加持中",
        3: "掉落",
        None: "读取失败"
    }.get(value, f"未知状态({value})") if value is not None else "读取失败"
    
    return {"success": success, "message": message, "value": value, "status_text": status_text}

@app.get("/read_clamping_position")
async def read_clamping_position():
    """读取加持位置反馈 (地址0x42)"""
    success, message, value = read_float_registers(0x42)
    return {"success": success, "message": message, "value": value}

@app.get("/read_clamping_speed")
async def read_clamping_speed():
    """读取加持速度反馈 (地址0x44)"""
    success, message, value = read_float_registers(0x44)
    return {"success": success, "message": message, "value": value}

@app.get("/read_clamping_current")
async def read_clamping_current():
    """读取加持电流反馈 (地址0x46)"""
    success, message, value = read_float_registers(0x46)
    return {"success": success, "message": message, "value": value}

# 新增：加持电流写入接口
@app.post("/write_clamping_current")
async def write_clamping_current(current: float = Form(...)):
    """写入加持电流 (地址0x06)"""
    if current < 0.1 or current > 0.5:
        return {"success": False, "message": "加持电流范围应为0.1-0.5A"}
    
    success, message = write_float_registers(0x06, current)
    return {"success": success, "message": message}






# 旋转部分接口
@app.post("/write_rotation_angle")
async def write_rotation_angle(angle: float = Form(...)):
    """写入旋转绝对角度 (地址0x0A)"""
    if angle < -3600000 or angle > 3600000:
        return {"success": False, "message": "旋转角度范围应为-3600000-3600000度"}
    
    success, message = write_float_registers(0x0A, angle)
    return {"success": success, "message": message}

@app.post("/write_rotation_speed")
async def write_rotation_speed(speed: float = Form(...)):
    """写入旋转速度 (地址0x0E)"""
    if speed < 1 or speed > 1080:
        return {"success": False, "message": "旋转速度范围应为1-1080度/秒"}
    
    success, message = write_float_registers(0x0E, speed)
    return {"success": success, "message": message}

@app.post("/write_rotation_current")
async def write_rotation_current(current: float = Form(...)):
    """写入旋转电流 (地址0x14)"""
    if current < 0.2 or current > 1.0:
        return {"success": False, "message": "旋转电流范围应为0.2-1.0A"}
    
    success, message = write_float_registers(0x14, current)
    return {"success": success, "message": message}

@app.get("/read_rotation_status")
async def read_rotation_status():
    """读取旋转状态反馈 (地址0x48)"""
    success, message, value = read_int_register(0x48)
    status_text = {
        0: "到位",
        1: "旋转中",
        2: "旋转受阻",
        3: "掉落",
        4: "堵转停转",
        None: "读取失败"
    }.get(value, f"未知状态({value})") if value is not None else "读取失败"
    
    return {"success": success, "message": message, "value": value, "status_text": status_text}

@app.get("/read_rotation_angle")
async def read_rotation_angle():
    """读取旋转角度反馈 (地址0x4A)"""
    success, message, value = read_float_registers(0x4A)
    return {"success": success, "message": message, "value": value}

@app.get("/read_rotation_speed")
async def read_rotation_speed():
    """读取旋转速度反馈 (地址0x4C)"""
    success, message, value = read_float_registers(0x4C)
    return {"success": success, "message": message, "value": value}





    
@app.get("/read_rotation_current")
async def read_rotation_current():
    """读取旋转电流反馈 (地址0x4E)"""
    success, message, value = read_float_registers(0x4E)
    return {"success": success, "message": message, "value": value}

# 批量读取所有状态
@app.get("/read_all_status")
async def read_all_status():
    """批量读取所有状态"""
    global modbus_connected
    
    if not modbus_connected:
        return {
            "success": False, 
            "message": "Modbus未连接，无法读取状态",
            "data": {}
        }
    
    status_data = {}
    
    # 读取所有状态寄存器
    readers = [
        ("gripper_id", read_int_register, 0x80),
        ("baud_rate", read_int_register, 0x81),
        ("gripper_init_status", read_int_register, 0x40),
        ("motor_enable", read_int_register, 0x16),
        ("init_direction", read_int_register, 0x82),
        ("auto_init", read_int_register, 0x83),
        ("rotation_stop_enable", read_int_register, 0x9E),
        ("rotation_stop_sensitivity", read_int_register, 0x9F),
        ("clamping_status", read_int_register, 0x41),
        ("clamping_position", read_float_registers, 0x42),
        ("clamping_speed", read_float_registers, 0x44),
        ("clamping_current", read_float_registers, 0x46),
        ("rotation_status", read_int_register, 0x48),
        ("rotation_angle", read_float_registers, 0x4A),
        ("rotation_speed", read_float_registers, 0x4C),
        ("rotation_current", read_float_registers, 0x4E),
        ("clamping_current_set", read_float_registers, 0x06),
        ("save_params", read_int_register, 0x84), 
    ]
    
    for name, reader_func, address in readers:
        success, message, value = reader_func(address)
        
        # 为特定状态添加状态文本
        status_text = None
        if name == "gripper_init_status":
            status_text = {
                0: "未初始化",
                5: "初始化完成",
                None: "读取失败"
            }.get(value, f"初始化中({value})") if value is not None else "读取失败"
        elif name == "clamping_status":
            status_text = {
                0: "到位",
                1: "运动中", 
                2: "加持中",
                3: "掉落",
                None: "读取失败"
            }.get(value, f"未知状态({value})") if value is not None else "读取失败"
        elif name == "rotation_status":
            status_text = {
                0: "到位",
                1: "旋转中",
                2: "旋转受阻", 
                3: "掉落",
                4: "堵转停转",
                None: "读取失败"
            }.get(value, f"未知状态({value})") if value is not None else "读取失败"
        elif name == "motor_enable":
            status_text = "使能" if value == 1 else "关闭" if value == 0 else "未知"
        elif name == "init_direction":
            status_text = "张开校准" if value == 0 else "闭合校准" if value == 1 else "未知"
        elif name == "auto_init":
            status_text = "上电自动校准" if value == 0 else "手动校准" if value == 1 else "未知"
        elif name == "rotation_stop_enable":
            status_text = "不使能" if value == 0 else "使能" if value == 1 else "未知"
        elif name == "baud_rate":
            status_text = BAUD_RATE_MAP.get(value, "未知") if value is not None else "未知"
        
        status_data[name] = {
            "success": success,
            "value": value,
            "message": message,
            "status_text": status_text
        }
    
    return {"success": True, "data": status_data}



# 添加Modbus连接状态检查接口
@app.get("/check_modbus_connected")
async def check_modbus_connected():
    """检查Modbus是否连接"""
    return {
        "modbus_connected": modbus_connected,
        "modbus_status": modbus_status,
        "last_check": last_modbus_check,
        "last_check_success": last_modbus_check_success
    }

# 启动时自动开始连接检查任务
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(check_connection_status())



@app.on_event("shutdown")
async def shutdown_event():
    """应用关闭时断开所有连接"""
    disconnect_arm()
    disconnect_robot()
    logger.info("应用已关闭，所有连接已断开")












if __name__ == "__main__":
    import uvicorn
    import os
    
    # 创建模板目录和静态文件目录
    os.makedirs("templates", exist_ok=True)
    os.makedirs("static", exist_ok=True)
    
    # 启动服务
    uvicorn.run(app, host="0.0.0.0", port=int(PORT))