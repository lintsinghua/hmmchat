import XCTest

/// Shared plumbing: the installed app, screenshots kept in the result bundle,
/// and log lines prefixed so a script can pull them out of xcodebuild's output.
class HmmChatTestCase: XCTestCase {
  var app: XCUIApplication!

  override func setUpWithError() throws {
    continueAfterFailure = true
    app = XCUIApplication(bundleIdentifier: "com.hmmchat.app")
    app.launch()
    XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 30))
    sleep(2)
  }

  func shot(_ name: String) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func log(_ line: String) {
    print("LOG| \(line)")
  }

  func dump(_ tag: String) {
    print("DUMP-BEGIN \(tag)\n\(app.debugDescription)\nDUMP-END \(tag)")
  }

  /// The first hittable element in a query whose centre lies inside `band`
  /// (a range of y), for labels that appear both in a dialog and behind it.
  func element(_ query: XCUIElementQuery, _ label: String, inY band: ClosedRange<CGFloat> = 0...10_000)
    -> XCUIElement?
  {
    query.matching(identifier: label).allElementsBoundByIndex.first { item in
      item.exists && band.contains(item.frame.midY)
    } ?? query.matching(NSPredicate(format: "label == %@", label)).allElementsBoundByIndex.first { item in
      item.exists && band.contains(item.frame.midY)
    }
  }

  func tapCentre(_ item: XCUIElement) {
    item.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
  }

  /// Settings, from wherever the app is: the setup button or the drawer.
  func openSettings() {
    if app.buttons["配置供应商"].exists {
      app.buttons["配置供应商"].tap()
    } else {
      app.buttons["对话列表"].tap()
      sleep(1)
      app.buttons["设置"].tap()
    }
    sleep(1)
  }

  var keyboardUp: Bool { app.keyboards.firstMatch.exists && app.keyboards.firstMatch.frame.height > 0 }
}
