import { describe, expect, it } from 'vitest'
import {
  extensionOf,
  formatBytes,
  hasNativeInput,
  isImage,
  isOffice,
  isPdf,
  isSupported,
  isText,
  limitsFor,
} from './attachments'
import { extractOfficeText } from './office-text'

describe('extension handling', () => {
  it('reads the extension, lowercased', () => {
    expect(extensionOf('Notes.MD')).toBe('md')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
    expect(extensionOf('Makefile')).toBe('')
  })

  it('classifies the formats we support', () => {
    expect(isText('ts')).toBe(true)
    expect(isImage('png')).toBe(true)
    expect(isPdf('pdf')).toBe(true)
    expect(isOffice('docx')).toBe(true)
    expect(isSupported('报告.docx')).toBe(true)
    expect(isSupported('app.dmg')).toBe(false)
  })

  it('gates only the formats that need to be seen', () => {
    // A text file is read on every model, so it never needs a file part; an
    // image or a PDF only reaches a model that accepts that kind of file.
    const can = { vision: true, pdf: true }
    expect(hasNativeInput('md', can)).toBe(false)
    expect(hasNativeInput('png', can)).toBe(true)
    expect(hasNativeInput('pdf', can)).toBe(true)

    // The two are separate capabilities, not one flag: the catalog has models
    // that read documents but not pictures.
    expect(hasNativeInput('pdf', { vision: false, pdf: true })).toBe(true)
    expect(hasNativeInput('png', { vision: false, pdf: true })).toBe(false)
    expect(hasNativeInput('png', { vision: false, pdf: false })).toBe(false)
  })

  it('accepts audio only on a model that can hear it', () => {
    expect(isSupported('meeting.mp3')).toBe(true)
    expect(hasNativeInput('mp3', { vision: true, pdf: true, audio: true })).toBe(true)
    expect(hasNativeInput('mp3', { vision: true, pdf: true })).toBe(false)
  })
})

describe('limitsFor', () => {
  it('splits the prompt budget across attached files', () => {
    expect(limitsFor(false, 1).maxTextChars).toBeGreaterThan(limitsFor(false, 5).maxTextChars)
    // A floor stops a long list of small files from starving each of them.
    expect(limitsFor(false, 50).maxTextChars).toBe(20_000)
  })
})

describe('formatBytes', () => {
  it('scales the unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('extractOfficeText', () => {
  it('returns an empty string for a file that is not a zip', async () => {
    expect(await extractOfficeText('docx', new Uint8Array([1, 2, 3]))).toBe('')
  })

  it('returns an empty string for an unknown extension', async () => {
    expect(await extractOfficeText('rtf', new Uint8Array(0))).toBe('')
  })
})
