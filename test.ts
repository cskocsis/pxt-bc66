BC66.onConnected(function () {
    basic.showIcon(IconNames.Happy)
})

input.onButtonPressed(Button.A, function () {
    BC66.sendNumber(123)
})

input.onButtonPressed(Button.B, function () {
    BC66.sendString("Hello")
})

basic.forever(function () {
    BC66.sendString("" + input.temperature())
    basic.pause(60000)
})

basic.showIcon(IconNames.Sad)
BC66.connect(SerialPin.P0, SerialPin.P1)// tests go here; this will not be compiled when this package is used as a library
