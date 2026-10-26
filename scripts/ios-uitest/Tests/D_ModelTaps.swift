import XCTest

/// Issue 3: in settings, tapping a model's row must toggle that model and only it.
final class D_ModelTaps: HmmChatTestCase {
  var rows: [XCUIElement] {
    app.switches.allElementsBoundByIndex.filter { $0.label.hasPrefix("Claude") }
  }

  func states() -> String {
    rows.map { "\($0.label.split(separator: " ").prefix(2).joined(separator: " "))=\($0.value as? String ?? "?")" }
      .joined(separator: ", ")
  }

  func openModels() {
    openSettings()
    let header = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Anthropic' AND label CONTAINS '个模型'")).firstMatch
    XCTAssertTrue(header.waitForExistence(timeout: 5))
    if rows.isEmpty { header.tap(); sleep(1) }
  }

  /// Taps the checkbox itself, at the left end of the row.
  func tapBox(_ index: Int) {
    let row = rows[index]
    log("tap row \(index) '\(row.label.prefix(18))' at \(row.frame)")
    row.coordinate(withNormalizedOffset: CGVector(dx: 0.03, dy: 0.5)).tap()
  }

  func testSlowTaps() throws {
    openModels()
    log("start: \(states())")
    for index in 0..<3 {
      tapBox(index); sleep(2)
      log("after: \(states())")
    }
    for index in 0..<3 { tapBox(index); sleep(2) }
    log("restored: \(states())")
  }

  func testQuickTaps() throws {
    openModels()
    log("start: \(states())")
    tapBox(0); tapBox(1); tapBox(2)
    sleep(3)
    log("after three quick taps: \(states())")
    shot("quick-taps")
    tapBox(0); tapBox(1); tapBox(2)
    sleep(3)
    log("after three more: \(states())")
  }

  func testAfterKeyboard() throws {
    openModels()
    let manual = app.textFields.allElementsBoundByIndex.first { $0.placeholderValue?.contains("手动添加") == true }
    XCTAssertNotNil(manual)
    manual?.tap(); sleep(1)
    manual?.typeText("x")
    sleep(1)
    shot("manual-typing")
    // Dismiss the way a user would: the accessory bar's done button.
    let done = app.buttons["完成"].exists ? app.buttons["完成"] : app.buttons["Done"]
    if done.exists { done.tap() } else { app.keyboards.buttons.allElementsBoundByIndex.last?.tap() }
    sleep(2)
    log("after keyboard: \(states())")
    tapBox(0); sleep(2)
    log("tapped row 0 after keyboard: \(states())")
    shot("after-keyboard-tap")
    tapBox(0); sleep(2)
    log("tapped row 0 again: \(states())")
  }
}
