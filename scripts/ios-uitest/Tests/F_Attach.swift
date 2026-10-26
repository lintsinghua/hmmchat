import XCTest

/// Attaching a file on a phone: the + menu, then iOS's own picker sheet.
final class F_Attach: HmmChatTestCase {
  func testFilePickerOpens() throws {
    if app.buttons["关闭"].exists { app.buttons["关闭"].tap(); sleep(1) }
    let add = app.descendants(matching: .any).matching(NSPredicate(format: "label == '添加'")).allElementsBoundByIndex
      .first { $0.frame.minY > 600 }
    XCTAssertNotNil(add)
    tapCentre(add!); sleep(1)
    let files = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '添加文件'")).firstMatch
    XCTAssertTrue(files.waitForExistence(timeout: 3), "no 添加文件 item")
    files.tap(); sleep(2)
    shot("after-add-files")
    let sheet = app.descendants(matching: .any).matching(NSPredicate(
      format: "label CONTAINS[c] '照片' OR label CONTAINS[c] 'Photo' OR label CONTAINS[c] '选取文件' OR label CONTAINS[c] 'Choose File' OR label CONTAINS[c] '浏览' OR label CONTAINS[c] 'Browse' OR label CONTAINS[c] '拍照'"))
    log("picker items: \(sheet.allElementsBoundByIndex.map { "\($0.elementType.rawValue):\($0.label)" })")
    XCTAssertGreaterThan(sheet.count, 0, "tapping 添加文件 opened nothing")
  }
}
