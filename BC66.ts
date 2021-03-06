/**
 * BC66 blocks
 */
//% weight=100 color=#e60073 icon="\uf212" block="BC66"
namespace BC66 {
    const DEBUG = false
    const enum NbiotEvents {
        ID = 7107,
        RX_END = 0,
        RECEIVED_MSG,
    }
    let lines: string[] = []
    let socket = -1
    let serverIp = "188.166.45.215"
    let serverPort = 41235
    let awaitingResponse = false
    let _isConnected = false
    const connectCallbacks: (() => void)[] = []

    /**
     * Connect to the BC66 NB-IoT module
     * This involves opening a serial connection on chosen pins and connect to the
     * BC66 NB-IoT network.
     * @param rx The pin that is connected to RXD on BC66, eg: SerialPin.P0
     * @param tx The pin that is connected to TXD on BC66, eg: SerialPin.P1
     */
    //% blockId=BC66_connect
    //% block="connect RX on %rx and TX on %tx"
    //% weight = 10
    export function connect(rx: SerialPin, tx: SerialPin): void {
        serial.redirect(tx, rx, BaudRate.BaudRate115200)
        basic.pause(1000)

        if (DEBUG) {
            control.onEvent(DAL.MICROBIT_ID_SERIAL, DAL.MICROBIT_SERIAL_EVT_RX_FULL, function () {
                basic.showIcon(IconNames.No)
            })
        }

        control.inBackground(() => {
            while (true) {
                readSerialData()
            }
        })

        drain()

        // the micro:bit spits out some garbage on the serial, so
        // send a dummy command that will fail
        serial.writeString("AT\r")
        basic.pause(100)
        reboot()

        // Echo mode OFF
        writeCommand("ATE0")

        // enable more detailed errors
        writeCommand("AT+CMEE=1")

        // Disable Sleep Mode
        writeCommand("AT+QSCLK=0")

        // disable eDRX
        writeCommand("AT+CEDRXS=0")

        // disable Power Save Mode
        writeCommand("AT+CPSMS=0")

        // trigger on connect callbacks
        control.inBackground(() => {
            while (checkConnection() != 1) {
                basic.pause(1000)
            }
            _isConnected = true

            connectCallbacks.forEach(cb => {
                cb()
                basic.pause(100)
            })
        })
    }

    /**
     * Get the IMSI from the sim card
     */
    //% block
    //% weight = 11
    export function imsi(): string {
        writeCommand("AT+CIMI")
        return readLine()
    }

    /**
     * Get the IMEI from the BC66
     */
    //% block
    //% weight = 12
    export function imei(): string {
        writeCommand("AT+CGSN=1")
        return readLine().substr(7, 15)
    }

    /**
     * Configure server IP address and port. When sending data,
     * it will be sent as an UPD message to this IP and port.
     * @param ip The IP address to send data, eg: "188.166.45.215"
     * @param port The port to send data, eg: 41234
     */
    //% blockId=BC66_set_server
    //% block="set|server ip %ip port %port"
    //% port.min=0 port.max=65535
    //% weight = 20
    export function setServer(ip: string, port: number) {
        serverIp = ip
        serverPort = port
    }

    /**
     * Execute custom code when we get a connection to the network
     * @param code The custom code block(s) to run when we get a connection
     */
    //% blockId=BC66_on_connected block="on BC66 connected"
    //% weight = 30
    export function onConnected(code: () => void): void {
        connectCallbacks.push(code)
    }

    /**
     * Send text or number as a string
     * @param str The text or number you want to send, eg: "Hello World!", 42
     */
    //% block
    //% str.shadowOptions.toString=true
    //% weight = 40
    export function sendString(str: string): void {
        const buf = pins.createBuffer(str.length)
        for (let i = 0; i < str.length; i++) {
            buf.setNumber(NumberFormat.UInt8BE, i, str.charCodeAt(i))
        }
        sendBuffer(buf)
    }

    /**
     * Send a number
     * @param num The number to send, eg: 42
     */
    //% block
    //% weight = 50
    export function sendNumber(num: number): void {
        sendBytes([num])
    }

    /**
     * Receive a message on port 41235
     */
    //% blockId=BC66_on_receive_string
    //% block="on BC66 received"
    //% blockHandlerKey="BC66received"
    //% weight = 60
    export function onReceivedString(callback: (text: string) => void): void {
        onReceivedBuffer((buffer: Buffer) => {
            let text = ""
            for (let i = 0; i < buffer.length; i++) {
                text += String.fromCharCode(buffer.getNumber(NumberFormat.UInt8LE, i))
            }
            callback(text)
        })
    }

    /**
     * Receive a number on port 41235
     * 
     * The number will be interpreted as a signed int in big endian format (max 32 bit)
     */
    //% blockId=BC66_on_receive_number
    //% block="on BC66 received"
    //% blockHandlerKey="BC66received"
    //% weight = 61
    export function onReceivedNumber(callback: (num: number) => void): void {
        onReceivedBuffer((buffer: Buffer) => {
            let format: NumberFormat
            if (buffer.length <= 1) {
                format = NumberFormat.Int8BE
            } else if (buffer.length <= 2) {
                format = NumberFormat.Int16BE
            } else if (buffer.length <= 4) {
                format = NumberFormat.Int32BE
            } else if (DEBUG) {
                basic.showString("Received number exeeds Int32")
                return
            }
            callback(buffer.getNumber(format, 0))
        })
    }

    /**
     * Send bytes
     * @param bytes An array of bytes
     */
    //% block
    //% weight = 70
    //% advanced=true
    export function sendBytes(bytes: number[]): void {
        const buf = pins.createBufferFromArray(bytes)
        sendBuffer(buf)
    }

    /**
     * Send buffer
     * @param buffer The buffered data to send
     */
    //% block
    //% weight = 71
    //% advanced=true
    export function sendBuffer(buffer: Buffer): void {
        if (!_isConnected || buffer.length == 0) {
            return
        }
        ensureSocket()
        writeCommand(`AT+QSOSEND=0,${buffer.length},${buffer.toHex()}`)
        //writeCommand(`AT+QSOSEND=0,13,4d6963726f6269742042433636`)
    }

    /**
     * Receive bytes on port 1234
     */
    //% blockId=BC66_on_receive_bytes
    //% block="on BC66 received"
    //% blockHandlerKey="BC66received"
    //% weight = 80
    //% advanced=true
    export function onReceivedBytes(callback: (bytes: number[]) => void): void {
        onReceivedBuffer((buffer: Buffer) => {
            let bytes: NumberFormat.UInt8LE[] = []
            for (let i = 0; i < buffer.length; i++) {
                bytes.push(buffer.getNumber(NumberFormat.UInt8LE, i))
            }
            callback(bytes)
        })
    }

    /**
     * Receive buffer on port 1234
     */
    //% blockId=BC66_on_receive_buffer
    //% block="on BC66 received"
    //% blockHandlerKey="BC66received"
    //% weight = 81
    //% advanced=true
    export function onReceivedBuffer(callback: (buffer: Buffer) => void) {
        onConnected(function () {
            ensureSocket()
        })
        control.onEvent(NbiotEvents.ID, NbiotEvents.RECEIVED_MSG, () => {
            const length = receivedMessageLength
            receivedMessageLength = 0
            writeCommand(`AT+QSORF=${socket},${length}`)
            // <socket>,"<ip_addr>",<port>,<length>,"<data>",<remaining_length>
            let fields = split(readLine(), ",")
            let received = parseInt(fields[3])
            let data = fields[4].substr(1, fields[4].length - 2) // strip quotes
            let buffer = control.createBuffer(received)
            for (let i = 0; i < received; i++) {
                let byte = hexToByte(data.charAt(i * 2) + data.charAt(i * 2 + 1))
                buffer.setNumber(NumberFormat.UInt8LE, i, byte)
            }

            callback(buffer)
        })
    }

    /**
     * Check if we're connected to the network
     * Returns true if the BC66 has successfully
     * attached to the network, or false if not.
     */
    //% block
    //% weight = 90
    export function isConnected(): boolean {
        return _isConnected
    }

    /**
     * Get signal strength in dBm
     */
    //% block
    //% advanced=true
    export function signalStrength(): number {
        writeCommand("AT+CSQ")
        let power = parseInt(readLine().substr(6, 2))
        if (power == 99) {
            return 99
        }
        return -113 + power * 2
    }

    /**
     * Create a socket to send/receive data
     */
    //% block
    //% advanced=true
    export function createSocket() {
        writeCommand(`AT+QSOC=1,2,1`)
        let response = readLine()
        socket = parseInt(response.charAt(6))
        writeCommand(`AT+QSOCON=0,${serverPort},"${serverIp}"`)
    }

    /**
     * Send raw AT-command to BC66 and wait for OK
     * After 3 failed attempts it reboots the micro:bit
     * @param cmd The full command, eg: "AT+CFUN=1"
     * @param retries How many times to retry in case the command fails, eg: 3
     * @param wait How long (in ms) to wait between a failed attempt and retrying, eg: 1000
     * @param timeout How long to wait for a response (in ms) before timing out, eg: 30000
     */
    //% blockId=nbiotBC66_write_command
    //% block="write command %cmd number of retries %retries wait between retries (ms) %wait timeout after (ms) %timeout"
    //% advanced=true
    export function writeCommand(cmd: string, retries = 3, wait = 1000, timeout = 30000): void {
        while (awaitingResponse) {
            basic.pause(100)
        }

        awaitingResponse = true

        while (retries-- > 0) {
            drain()

            serial.writeString(cmd + "\r")
            if (waitForResponse(timeout)) {
                // success
                awaitingResponse = false
                return
            }
            basic.pause(wait)
        }
        if (DEBUG) {
            basic.showString("ERR exec: " + cmd)
        }
        die()
    }

    /**
     * Check if we have unread response lines
     */
    //% block
    //% advanced=true
    export function availableLines(): number {
        return lines.length
    }

    /**
     * Read response line from BC66
     */
    //% block
    //% advanced=true
    export function readLine(): string {
        if (availableLines() == 0) {
            return ""
        }
        return lines.shift()
    }

    /**
     * Reboot the BC66
     */
    //% block 
    //% advanced=true
    export function reboot(): boolean {
        serial.writeString("AT+QRST=1\r")
        basic.pause(2000)
        drain()
        return waitForResponse()
    }

    let rxData = ""
    function readSerialData(): void {
        // block read until we get a character
        let tmp = serial.readBuffer(1)
        let char = String.fromCharCode(tmp.getNumber(NumberFormat.UInt8LE, 0))
        rxData += char

        // check if we have a complete line
        let lineEnd = rxData.indexOf("\r\n")
        if (lineEnd == -1) {
            return
        }
        // ignore empty lines
        if (lineEnd > 0) {
            lines.push(rxData.substr(0, lineEnd))
            control.inBackground(checkResponseLine)
        }
        rxData = rxData.substr(lineEnd + 2)
    }

    let receivedMessageLength = 0
    function checkResponseLine() {
        if (lines.length == 0) {
            return
        }
        let lastLine = lines[lines.length - 1]
        if (lastLine.indexOf("+QSONMI") == 0) {
            // +NSONMI: <socket>,<length>
            receivedMessageLength = parseInt(split(lastLine, ",")[1])
            if (receivedMessageLength > 0) {
                control.inBackground(function () {
                    basic.pause(10)
                    control.raiseEvent(NbiotEvents.ID, NbiotEvents.RECEIVED_MSG)
                })
            }
        } else if (lastLine == "OK" || lastLine.indexOf("ERROR") >= 0) {
            control.raiseEvent(NbiotEvents.ID, NbiotEvents.RX_END)
        }
    }

    function waitForResponse(timeout = 10000): boolean {
        const delayTime = 100
        let end = input.runningTime() + timeout

        while (input.runningTime() < end) {
            if (lines.length > 0) {
                let lastLine = lines[lines.length - 1]
                if (lastLine == "OK") {
                    return true
                } else if (lastLine.indexOf("ERROR") >= 0) {
                    if (DEBUG && lastLine.indexOf("+CME") == 0) {
                        let err = lastLine.substr(12)
                        basic.showString(`E${err}`)
                    }
                    return false
                }
            }
            basic.pause(delayTime)
        }
        return false
    }

    function ensureSocket() {
        if (socket == -1) {
            createSocket()
        }
    }

    function split(str: string, separator: string): string[] {
        let start = 0
        let result: string[] = []
        while (true) {
            let end = str.indexOf(separator, start)
            if (end == -1) {
                result.push(str.substr(start))
                return result
            }
            result.push(str.substr(start, end - start))
            start = end + separator.length
        }
    }

    const hexAlphabet = "0123456789ABCDEF"
    function hexToByte(hex: string): NumberFormat.UInt8LE {
        let h1 = hexAlphabet.indexOf(hex.charAt(0))
        let h2 = hexAlphabet.indexOf(hex.charAt(1))
        return (h1 << 4) + h2
    }

    /**
     * Discard unread received serial data
     */
    export function drain(): void {
        rxData = ""
        while (lines.length > 0) {
            lines.pop()
        }
    }

    function checkConnection(): number {
        writeCommand("AT+CEREG?")
        let response = readLine()
        return parseInt(response.charAt(10))
        //   return 1
    }

    function die(): boolean {
        basic.showIcon(IconNames.Skull)
        basic.pause(5000)
        control.reset()
        return false
    }
}
// Add your code here
