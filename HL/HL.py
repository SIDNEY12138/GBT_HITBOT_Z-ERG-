from Agilebot.IR.A.arm import Arm
from Agilebot.IR.A.status_code import StatusCodeEnum
from Agilebot.IR.A.sdk_classes import Register, SerialParams
from Agilebot.IR.A.sdk_types import ModbusChannel, ModbusParity
import struct
import time

logger = globals().get('logger')
if logger is None:
    import logging
    logger = logging.getLogger(__name__)
logger.info("开始")

arm = Arm()
ret = arm.connect("10.27.1.254")
if ret != StatusCodeEnum.OK:
    logger.error("连接失败")

# 全局存储夹爪连接状态
gripper_connections = {}

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
        
def connect(id: int, baud_rate: int = 115200, parity: str = "NONE", 
               data_bits: int = 8, stop_bits: int = 1, timeout: int = 500) -> int:
    """
    连接夹爪
    
    Args:
        id: 夹爪ID (1-247)
        baud_rate: 波特率 (9600, 19200, 38400, 57600, 115200, 153600, 256000)
        parity: 奇偶校验 ("NONE", "ODD", "EVEN")
        data_bits: 数据位 (7, 8)
        stop_bits: 停止位 (1, 2)
        timeout: 超时时间(毫秒) (100-800)
    
    Returns:
        0: 成功
    
    Raises:
        ValueError: 参数验证失败
        ConnectionError: 连接失败
        Exception: 其他错误
    """
    try:
        logger.info(f"connect - 连接夹爪 ID: {id}, 波特率: {baud_rate}, 奇偶校验: {parity}, 数据位: {data_bits}, 停止位: {stop_bits}, 超时: {timeout}ms")
        
        # 参数类型验证
        try:
            # 验证ID类型和范围
            if not isinstance(id, int):
                raise ValueError(f"夹爪ID必须为整数类型，当前类型: {type(id).__name__}")
            
            if id < 1 or id > 247:
                raise ValueError(f"夹爪ID范围应为1-247，当前值: {id}")
        except (ValueError, TypeError) as e:
            logger.error(f"夹爪ID参数格式错误: {e}")
            raise ValueError(f"夹爪ID参数错误: {e}") from e
        
        # 验证波特率类型和范围
        try:
            if not isinstance(baud_rate, int):
                raise ValueError(f"波特率必须为整数类型，当前类型: {type(baud_rate).__name__}")
            
            # 波特率映射到枚举值
            baud_rate_map = {
                9600: 0, 19200: 1, 38400: 2, 57600: 3, 
                115200: 4, 153600: 5, 256000: 6
            }
            if baud_rate not in baud_rate_map:
                raise ValueError(f"不支持的波特率: {baud_rate}，支持的波特率: {list(baud_rate_map.keys())}")
        except (ValueError, TypeError) as e:
            logger.error(f"波特率参数格式错误: {e}")
            raise ValueError(f"波特率参数错误: {e}") from e
        
        # 验证奇偶校验类型和值
        try:
            if not isinstance(parity, str):
                raise ValueError(f"奇偶校验必须为字符串类型，当前类型: {type(parity).__name__}")
            
            # 奇偶校验映射
            parity_map = {
                "NONE": ModbusParity.NONE,
                "ODD": ModbusParity.ODD, 
                "EVEN": ModbusParity.EVEN
            }
            if parity.upper() not in parity_map:
                raise ValueError(f"不支持的奇偶校验: {parity}，支持的奇偶校验: {list(parity_map.keys())}")
            
            # 转换为大写统一处理
            parity = parity.upper()
        except (ValueError, TypeError, AttributeError) as e:
            logger.error(f"奇偶校验参数格式错误: {e}")
            raise ValueError(f"奇偶校验参数错误: {e}") from e
        
        # 验证数据位类型和范围
        try:
            if not isinstance(data_bits, int):
                raise ValueError(f"数据位必须为整数类型，当前类型: {type(data_bits).__name__}")
            
            if data_bits not in [7, 8]:
                raise ValueError(f"数据位必须为7或8，当前值: {data_bits}")
        except (ValueError, TypeError) as e:
            logger.error(f"数据位参数格式错误: {e}")
            raise ValueError(f"数据位参数错误: {e}") from e
        
        # 验证停止位类型和范围
        try:
            if not isinstance(stop_bits, int):
                raise ValueError(f"停止位必须为整数类型，当前类型: {type(stop_bits).__name__}")
            
            if stop_bits not in [1, 2]:
                raise ValueError(f"停止位必须为1或2，当前值: {stop_bits}")
        except (ValueError, TypeError) as e:
            logger.error(f"停止位参数格式错误: {e}")
            raise ValueError(f"停止位参数错误: {e}") from e
        
        # 验证超时时间类型和范围
        try:
            if not isinstance(timeout, int):
                raise ValueError(f"超时时间必须为整数类型，当前类型: {type(timeout).__name__}")
            
            if timeout < 100 or timeout > 800:
                raise ValueError(f"超时时间范围应为100-800毫秒，当前值: {timeout}")
        except (ValueError, TypeError) as e:
            logger.error(f"超时时间参数格式错误: {e}")
            raise ValueError(f"超时时间参数错误: {e}") from e
        
        # 所有参数验证通过后，设置Modbus参数
        params = SerialParams(
            channel=ModbusChannel.WRIST_485_0, 
            ip="", 
            port=502, 
            baud=baud_rate,
            data_bit=data_bits,
            stop_bit=stop_bits, 
            parity=parity_map[parity],
            timeout=timeout
        )
        
        # 设置参数
        modbus_id, ret_code = arm.modbus.set_parameter(params)
        if ret_code != StatusCodeEnum.OK:
            error_msg = f"设置Modbus参数失败: {ret_code.errmsg}"
            logger.error(error_msg)
            raise ConnectionError(error_msg)
        
        # 获取slave实例
        slave_instance = arm.modbus.get_slave(ModbusChannel.WRIST_485_0, id, 1)
        if not slave_instance:
            error_msg = f"获取夹爪{id}的slave实例失败"
            logger.error(error_msg)
            raise ConnectionError(error_msg)
        
        # 测试连接 - 读取夹爪ID
        try:
            registers, status = slave_instance.read_holding_regs(0x80, 1)
            if status == StatusCodeEnum.OK and len(registers) >= 1:
                read_id = registers[0]
                if read_id == id:
                    logger.info(f"夹爪{id}连接成功，ID验证通过")
                    # 存储连接状态
                    gripper_connections[id] = {
                        'slave': slave_instance,
                        'baud_rate': baud_rate,
                        'connected': True
                    }
                    return 0
                else:
                    error_msg = f"夹爪ID验证失败，期望: {id}, 实际: {read_id}"
                    logger.error(error_msg)
                    raise ConnectionError(error_msg)
            else:
                error_msg = f"读取夹爪ID失败: {status}"
                logger.error(error_msg)
                raise ConnectionError(error_msg)
                
        except Exception as e:
            logger.error(f"测试连接时发生异常: {str(e)}")
            raise ConnectionError(f"测试连接失败: {e}") from e
            
    except (ValueError, ConnectionError):
        # 重新抛出已经处理的异常
        raise
    except Exception as e:
        logger.error(f"connect发生未知错误: {e}")
        raise Exception(f"连接过程中发生未知错误: {e}") from e

def move(id: int, position: float, speed: float) -> int:
    """
    控制夹爪移动
    
    Args:
        id: 夹爪ID
        position: 目标位置 (0-20mm)
        speed: 移动速度 (1-100mm/s)
    
    Returns:
        0: 成功
    
    Raises:
        ValueError: 参数验证失败
        ConnectionError: 连接失败
        RuntimeError: 操作失败
        Exception: 其他错误
    """
    try:
        logger.info(f"move - 夹爪{id}移动到位置: {position}mm, 速度: {speed}mm/s")
        
        # 检查连接状态
        if id not in gripper_connections or not gripper_connections[id]['connected']:
            error_msg = f"夹爪{id}未连接，请先调用connect"
            logger.error(error_msg)
            raise ConnectionError(error_msg)
        
        # 参数验证
        if position < 0 or position > 20:
            error_msg = f"位置范围应为0-20mm，当前值: {position}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        if speed < 1 or speed > 100:
            error_msg = f"速度范围应为1-100mm/s，当前值: {speed}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        slave_instance = gripper_connections[id]['slave']

        
        # 写入速度 (地址4),需要先写入速度，如果先写入位置，夹爪立马就动了
        speed_registers = ModbusHelper.float_to_registers(speed)
        result = slave_instance.write_holding_regs(4, speed_registers)
        if result != StatusCodeEnum.OK:
            error_msg = f"写入速度失败: {result}"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        logger.info(f"夹爪{id}移动命令发送成功")







        
        # 写入位置 (地址2)
        position_registers = ModbusHelper.float_to_registers(position)
        result = slave_instance.write_holding_regs(2, position_registers)
        if result != StatusCodeEnum.OK:
            error_msg = f"写入位置失败: {result}"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        return 0        

        
    except (ValueError, ConnectionError, RuntimeError):
        raise
    except Exception as e:
        logger.error(f"move发生错误: {e}")
        raise Exception(f"移动操作失败: {e}") from e

def rotate(id: int, angle: float, speed: float) -> int:
    """
    控制夹爪旋转
    
    Args:
        id: 夹爪ID
        angle: 绝对角度 (-3600000 到 3600000度)
        speed: 旋转速度 (1-1080度/秒)
    
    Returns:
        0: 成功
    
    Raises:
        ValueError: 参数验证失败
        ConnectionError: 连接失败
        RuntimeError: 操作失败
        Exception: 其他错误
    """
    try:
        logger.info(f"rotate - 夹爪{id}旋转到角度: {angle}度, 速度: {speed}度/秒")
        
        # 检查连接状态
        if id not in gripper_connections or not gripper_connections[id]['connected']:
            error_msg = f"夹爪{id}未连接，请先调用connect"
            logger.error(error_msg)
            raise ConnectionError(error_msg)
        
        # 参数验证
        if angle < -3600000 or angle > 3600000:
            error_msg = f"角度范围应为-3600000到3600000度，当前值: {angle}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        if speed < 1 or speed > 1080:
            error_msg = f"速度范围应为1-1080度/秒，当前值: {speed}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        slave_instance = gripper_connections[id]['slave']


        
        # 写入旋转速度 (地址0x0E)，需要写写入速度，如果先写入角度，夹爪立马就转了
        speed_registers = ModbusHelper.float_to_registers(speed)
        result = slave_instance.write_holding_regs(0x0E, speed_registers)
        if result != StatusCodeEnum.OK:
            error_msg = f"写入旋转速度失败: {result}"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        
        logger.info(f"夹爪{id}旋转命令发送成功")






        
        # 写入绝对角度 (地址0x0A)
        angle_registers = ModbusHelper.float_to_registers(angle)
        result = slave_instance.write_holding_regs(0x0A, angle_registers)
        if result != StatusCodeEnum.OK:
            error_msg = f"写入角度失败: {result}"
            logger.error(error_msg)
            raise RuntimeError(error_msg)
        return 0



        

        
    except (ValueError, ConnectionError, RuntimeError):
        raise
    except Exception as e:
        logger.error(f"rotate发生错误: {e}")
        raise Exception(f"旋转操作失败: {e}") from e

def wait_clamping_position(id: int, target_position: float, tolerance: float = 0.5, 
                             timeout: float = 30.0, check_interval: float = 0.1) -> int:
    """
    等待夹持到具体位置
    
    Args:
        id: 夹爪ID
        target_position: 目标位置 (0-20mm)
        tolerance: 允许的误差范围 (mm)
        timeout: 超时时间(秒)
        check_interval: 检查间隔(秒)
    
    Returns:
        0: 成功到达目标位置
    
    Raises:
        ValueError: 参数验证失败
        ConnectionError: 连接失败
        TimeoutError: 等待超时
        RuntimeError: 操作异常
        Exception: 其他错误
    """
    try:
        logger.info(f"wait_clamping_position - 等待夹爪{id}到达位置: {target_position}mm, 容差: {tolerance}mm")
        
        # 参数验证
        if target_position < 0 or target_position > 20:
            error_msg = f"目标位置范围应为0-20mm，当前值: {target_position}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        if tolerance <= 0:
            error_msg = f"容差必须大于0，当前值: {tolerance}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        # 检查连接状态
        if id not in gripper_connections or not gripper_connections[id]['connected']:
            error_msg = f"夹爪{id}未连接"
            logger.error(error_msg)
            raise ConnectionError(error_msg)
        
        slave_instance = gripper_connections[id]['slave']
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                # 读取当前位置 (地址0x42)
                registers, status = slave_instance.read_holding_regs(0x42, 2)
                
                if status != StatusCodeEnum.OK or len(registers) != 2:
                    logger.warning(f"读取当前位置失败，重试...")
                    time.sleep(check_interval)
                    continue
                
                current_position = ModbusHelper.registers_to_float(registers)
                
                # 检查是否到达目标位置
                position_diff = abs(current_position - target_position)
                
                if position_diff <= tolerance:
                    logger.info(f"夹爪{id}已到达目标位置: {current_position:.2f}mm, 目标: {target_position}mm")
                    return 0  # 成功到达目标位置
                
                # 读取夹持状态检查是否异常
                status_registers, status_code = slave_instance.read_holding_regs(0x41, 1)
                if status_code == StatusCodeEnum.OK and len(status_registers) >= 1:
                    clamping_status = status_registers[0]
                    if clamping_status == 3:  # 掉落
                        error_msg = f"夹爪{id}夹持异常，物体掉落"
                        logger.error(error_msg)
                        raise RuntimeError(error_msg)
                
                # 显示进度
                elapsed = time.time() - start_time
                if int(elapsed * 10) % 5 == 0:  # 每0.5秒打印一次
                    logger.info(f"当前位置: {current_position:.2f}mm, 目标: {target_position}mm, 差值: {position_diff:.2f}mm, 已等待{elapsed:.1f}秒")
                
                time.sleep(check_interval)
                
            except (RuntimeError):
                raise
            except Exception as e:
                logger.warning(f"读取位置时发生错误: {e}，重试...")
                time.sleep(check_interval)
        
        # 超时
        error_msg = f"夹爪{id}到达目标位置等待超时({timeout}秒)"
        logger.error(error_msg)
        raise TimeoutError(error_msg)
        
    except (ValueError, ConnectionError, TimeoutError, RuntimeError):
        raise
    except Exception as e:
        logger.error(f"wait_clamping_position发生错误: {e}")
        raise Exception(f"等待夹持位置失败: {e}") from e

def wait_rotation_angle(id: int, target_angle: float, tolerance: float = 1.0,
                           timeout: float = 30.0, check_interval: float = 0.1) -> int:
    """
    等待旋转到具体角度
    
    Args:
        id: 夹爪ID
        target_angle: 目标角度 (度)
        tolerance: 允许的误差范围 (度)
        timeout: 超时时间(秒)
        check_interval: 检查间隔(秒)
    
    Returns:
        0: 成功到达目标角度
    
    Raises:
        ValueError: 参数验证失败
        ConnectionError: 连接失败
        TimeoutError: 等待超时
        RuntimeError: 操作异常
        Exception: 其他错误
    """
    try:
        logger.info(f"wait_rotation_angle - 等待夹爪{id}到达角度: {target_angle}度, 容差: {tolerance}度")
        
        # 参数验证
        if target_angle < -3600000 or target_angle > 3600000:
            error_msg = f"目标角度范围应为-3600000到3600000度，当前值: {target_angle}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        if tolerance <= 0:
            error_msg = f"容差必须大于0，当前值: {tolerance}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        # 检查连接状态
        if id not in gripper_connections or not gripper_connections[id]['connected']:
            error_msg = f"夹爪{id}未连接"
            logger.error(error_msg)
            raise ConnectionError(error_msg)
        
        slave_instance = gripper_connections[id]['slave']
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                # 读取当前角度 (地址0x4A)
                registers, status = slave_instance.read_holding_regs(0x4A, 2)
                
                if status != StatusCodeEnum.OK or len(registers) != 2:
                    logger.warning(f"读取当前角度失败，重试...")
                    time.sleep(check_interval)
                    continue
                
                current_angle = ModbusHelper.registers_to_float(registers)
                
                # 计算角度差
                angle_diff = abs(current_angle - target_angle)
                
                # 检查是否到达目标角度
                if angle_diff <= tolerance:
                    logger.info(f"夹爪{id}已到达目标角度: {current_angle:.2f}度, 目标: {target_angle}度")
                    return 0  # 成功到达目标角度
                
                # 读取旋转状态检查是否异常
                status_registers, status_code = slave_instance.read_holding_regs(0x48, 1)
                if status_code == StatusCodeEnum.OK and len(status_registers) >= 1:
                    rotation_status = status_registers[0]
                    if rotation_status in [2, 3, 4]:  # 旋转受阻、掉落、堵转
                        error_msg = f"夹爪{id}旋转异常，状态码: {rotation_status}"
                        logger.error(error_msg)
                        raise RuntimeError(error_msg)
                
                # 显示进度
                elapsed = time.time() - start_time
                if int(elapsed * 10) % 5 == 0:  # 每0.5秒打印一次
                    logger.info(f"当前角度: {current_angle:.2f}度, 目标: {target_angle}度, 差值: {angle_diff:.2f}度, 已等待{elapsed:.1f}秒")
                
                time.sleep(check_interval)
                
            except (RuntimeError):
                raise
            except Exception as e:
                logger.warning(f"读取角度时发生错误: {e}，重试...")
                time.sleep(check_interval)
        
        # 超时
        error_msg = f"夹爪{id}到达目标角度等待超时({timeout}秒)"
        logger.error(error_msg)
        raise TimeoutError(error_msg)
        
    except (ValueError, ConnectionError, TimeoutError, RuntimeError):
        raise
    except Exception as e:
        logger.error(f"wait_rotation_angle发生错误: {e}")
        raise Exception(f"等待旋转角度失败: {e}") from e

def disconnect(id: int) -> int:
    """
    断开夹爪连接
    
    Args:
        id: 夹爪ID
    
    Returns:
        0: 成功
    
    Raises:
        Exception: 断开连接失败
    """
    try:
        if id in gripper_connections:
            del gripper_connections[id]
            logger.info(f"夹爪{id}已断开连接")
            return 0
        else:
            logger.warning(f"夹爪{id}未连接")
            return 0
    except Exception as e:
        logger.error(f"disconnect发生错误: {e}")
        raise Exception(f"断开连接失败: {e}") from e

