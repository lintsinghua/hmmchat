import XCTest

/// Adds an Anthropic provider pointed at the local mock, through the real form,
/// with the real software keyboard.
final class A_Onboard: HmmChatTestCase {
  func testAddProvider() throws {
    openSettings()
    if app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Anthropic' AND label CONTAINS '个模型'")).firstMatch.exists {
      log("provider already present"); return
    }
    element(app.buttons, "添加", inY: 0...400)!.tap()
    sleep(1)
    app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Anthropic'")).firstMatch.tap()
    sleep(1)
    dump("preset")
    let fields = app.textFields.allElementsBoundByIndex.filter { $0.frame.minY < 800 }
    log("textFields \(fields.count) secure \(app.secureTextFields.count)")
    let url = fields[1]
    url.tap()
    sleep(1)
    log("keyboard after tapping url: \(keyboardUp) \(app.keyboards.firstMatch.frame)")
    shot("form-keyboard")
    let current = (url.value as? String) ?? ""
    url.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
    url.typeText("http://127.0.0.1:8787/anthropic/v1")
    let key = app.secureTextFields.firstMatch
    key.tap()
    key.typeText("test-key")
    shot("form-filled")
    element(app.buttons, "保存")!.tap()
    sleep(3)
    shot("saved")
    dump("saved")
  }
}
