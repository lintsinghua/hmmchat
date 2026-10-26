import XCTest

/// Issue 2: with the keyboard up — a full on-screen keyboard, or the strip iOS
/// shows instead when a hardware keyboard is attached — the composer sits right
/// above it, controls included.
final class B_Keyboard: HmmChatTestCase {
  func testComposerAboveKeyboard() throws {
    if app.buttons["关闭"].exists { app.buttons["关闭"].tap(); sleep(1) }
    app.buttons["新对话"].tap(); sleep(1)
    let box = app.textViews.firstMatch
    XCTAssertTrue(box.waitForExistence(timeout: 10))
    let restingSend = app.buttons["发送"].frame
    box.tap()
    sleep(2)
    box.typeText("键盘弹出时输入框应该在键盘上方")
    sleep(1)
    let keyboard = app.keyboards.firstMatch.frame
    let send = app.buttons["发送"].frame
    let full = keyboard.height > 150 && keyboard.minY < 874
    log("mode=\(full ? "full keyboard" : "bar") keyboard=\(keyboard) send=\(send) resting send=\(restingSend)")
    shot("composer-keyboard-\(full ? "full" : "bar")")

    // The strip's top edge, when only the strip shows, is the accessory bar's.
    let covered = full ? keyboard.minY : coveredTop()
    log("covered from y=\(covered); send bottom \(send.maxY); gap \(covered - send.maxY)")
    XCTAssertLessThanOrEqual(send.maxY, covered, "send button is under the keyboard")
    XCTAssertLessThan(covered - send.maxY, 40, "composer floats well above the keyboard")

    // Dismissed, it goes back down to its resting place.
    app.otherElements.matching(NSPredicate(format: "label == '主要'")).firstMatch
      .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
    sleep(2)
    log("after dismiss: send \(app.buttons["发送"].frame) keyboard up \(keyboardUp && app.keyboards.firstMatch.frame.minY < 874)")
    XCTAssertEqual(app.buttons["发送"].frame.minY, restingSend.minY, accuracy: 2)
  }

  /// With a hardware keyboard, iOS shows a floating strip in the keyboard's
  /// place; XCUITest reports the keyboard as below the screen, so the strip's
  /// top is found from the buttons on it.
  func coveredTop() -> CGFloat {
    let tops = app.buttons.allElementsBoundByIndex
      .filter { $0.exists && $0.frame.minY > 700 && !$0.label.isEmpty && $0.label != "发送" && $0.frame.width < 80 }
      .map(\.frame.minY)
    return tops.max().map { $0 - 6 } ?? 874
  }
}
