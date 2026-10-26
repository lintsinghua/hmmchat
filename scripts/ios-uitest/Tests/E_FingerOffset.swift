import XCTest

/// Issue 3, as a finger does it. Each row's tappable area is its whole height
/// with no gap to the next, so a tap anywhere inside a row's frame — near its
/// top or bottom edge, where a finger aimed at the text often lands — toggles
/// that row and no other.
final class E_FingerOffset: HmmChatTestCase {
  var rows: [XCUIElement] { app.switches.allElementsBoundByIndex.filter { $0.label.hasPrefix("Claude") } }

  func values() -> [String] { rows.map { $0.value as? String ?? "?" } }

  func testEdgesOfEachRow() throws {
    openSettings()
    let header = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Anthropic' AND label CONTAINS '个模型'")).firstMatch
    XCTAssertTrue(header.waitForExistence(timeout: 5))
    if rows.isEmpty { header.tap(); sleep(1) }
    let frames = rows.map(\.frame)
    log("rows \(frames)")
    for (index, frame) in frames.enumerated() {
      XCTAssertGreaterThanOrEqual(frame.height, 44, "row \(index) is shorter than a finger")
      for dy in [3.0, frame.height - 3.0] {
        let before = values()
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.minX + 80, dy: frame.minY + dy)).tap()
        sleep(2)
        let after = values()
        let changed = after.indices.filter { after[$0] != before[$0] }
        log("row \(index) tap at +\(dy): changed rows \(changed)")
        XCTAssertEqual(changed, [index], "a tap inside row \(index) changed rows \(changed)")
        rows[index].tap(); sleep(2)
      }
    }
  }
}
