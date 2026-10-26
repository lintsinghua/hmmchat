import XCTest

/// Issue 1: the reasoning-depth control in the composer — one model, several,
/// and with the keyboard up.
final class C_Reasoning: HmmChatTestCase {
  var control: XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "label == '思考深度'")).firstMatch
  }

  var menuOpen: Bool { app.buttons["最高"].exists }

  func fresh() {
    if app.buttons["关闭"].exists { app.buttons["关闭"].tap(); sleep(1) }
    app.buttons["新对话"].tap(); sleep(1)
  }

  func testOneModel() throws {
    fresh()
    XCTAssertTrue(control.exists, "no reasoning control")
    XCTAssertTrue(control.isHittable, "reasoning control cannot be tapped")
    tapCentre(control); sleep(1)
    XCTAssertTrue(menuOpen, "menu did not open")
    app.buttons["高"].tap(); sleep(1)
    log("one model: picked 高; menu still open \(menuOpen)")
    XCTAssertFalse(menuOpen, "menu stays open after picking a level")
    shot("one-model-picked")
  }

  func testKeyboardUp() throws {
    fresh()
    let box = app.textViews.firstMatch
    box.tap(); sleep(2)
    box.typeText("想调一下深度")
    log("keyboard \(app.keyboards.firstMatch.frame) control \(control.frame) hittable \(control.isHittable)")
    XCTAssertTrue(control.isHittable, "reasoning control is hidden while typing")
    tapCentre(control); sleep(1)
    XCTAssertTrue(menuOpen, "menu did not open while typing")
    shot("keyboard-menu")
    let low = app.buttons["低"]
    log("menu item 低 \(low.frame) hittable \(low.isHittable)")
    XCTAssertTrue(low.isHittable, "levels are out of reach")
    low.tap(); sleep(1)
    XCTAssertFalse(menuOpen)
    XCTAssertEqual(box.value as? String, "想调一下深度", "the draft was lost")
    shot("keyboard-picked")
  }

  func testTwoModels() throws {
    fresh()
    let box = app.textViews.firstMatch
    box.tap(); box.typeText("比较一下")
    app.buttons["发送"].tap(); sleep(4)
    let compare = app.descendants(matching: .any).matching(NSPredicate(format: "label == '对比'")).firstMatch
    tapCentre(compare); sleep(1)
    let haiku = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Haiku'")).allElementsBoundByIndex.first { $0.isHittable }
    XCTAssertNotNil(haiku, "no model to compare with")
    haiku?.tap(); sleep(1)
    app.otherElements.matching(NSPredicate(format: "label == '主要'")).firstMatch
      .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
    sleep(1)
    XCTAssertTrue(control.exists && control.isHittable, "no reasoning control with two columns")
    tapCentre(control); sleep(1)
    shot("two-models-panel")
    // One segmented row per column; pick 高 in the first and 低 in the second.
    let highs = app.buttons.matching(NSPredicate(format: "label == '高'")).allElementsBoundByIndex.filter(\.isHittable)
    let lows = app.buttons.matching(NSPredicate(format: "label == '低'")).allElementsBoundByIndex.filter(\.isHittable)
    log("two models: rows of levels \(highs.count) / \(lows.count)")
    XCTAssertEqual(highs.count, 2)
    highs.first?.tap(); sleep(1)
    lows.last?.tap(); sleep(1)
    shot("two-models-set")
  }
}
