import { describe, expect, it } from 'vitest'

import { formatSiteAddress, getSitePostcode } from './site-address.js'

describe('formatSiteAddress', () => {
  it('joins all fields of a nested object, excluding the postcode', () => {
    const payload = {
      siteAddress: {
        line1: '1 Details Lane',
        line2: 'Unit 4',
        town: 'Leeds',
        postcode: 'LS1 1AB'
      }
    }
    expect(formatSiteAddress(payload)).toBe('1 Details Lane, Unit 4, Leeds')
  })

  it('omits an empty line2', () => {
    const payload = {
      siteAddress: {
        line1: '1 Details Lane',
        line2: '',
        town: 'Leeds',
        postcode: 'LS1 1AB'
      }
    }
    expect(formatSiteAddress(payload)).toBe('1 Details Lane, Leeds')
  })

  it('handles a nested object with only a town', () => {
    const payload = { siteAddress: { town: 'Leeds', postcode: 'LS1 1AB' } }
    expect(formatSiteAddress(payload)).toBe('Leeds')
  })

  it('trims whitespace and drops whitespace-only fields', () => {
    const payload = {
      siteAddress: {
        line1: '  1 Details Lane  ',
        line2: '   ',
        town: '  Leeds  '
      }
    }
    expect(formatSiteAddress(payload)).toBe('1 Details Lane, Leeds')
  })

  it('coerces the nested object to null when every field is blank', () => {
    const payload = {
      siteAddress: { line1: '', line2: '   ', town: '', postcode: 'LS1 1AB' }
    }
    expect(formatSiteAddress(payload)).toBeNull()
  })

  it('returns a legacy flat string trimmed', () => {
    const payload = { siteAddress: '  1 Main St, Leeds, LS1 1AB  ' }
    expect(formatSiteAddress(payload)).toBe('1 Main St, Leeds, LS1 1AB')
  })

  it('returns null for an empty legacy string', () => {
    expect(formatSiteAddress({ siteAddress: '   ' })).toBeNull()
  })

  it('ignores non-string junk field types in a nested object', () => {
    const payload = {
      siteAddress: { line1: 42, line2: null, town: { nested: true } }
    }
    expect(formatSiteAddress(payload)).toBeNull()
  })

  it('returns null when siteAddress is a non-object, non-string type', () => {
    expect(formatSiteAddress({ siteAddress: 42 })).toBeNull()
  })

  it('returns null when siteAddress is absent', () => {
    expect(formatSiteAddress({})).toBeNull()
  })

  it('does not throw on null / undefined payload', () => {
    expect(formatSiteAddress(null)).toBeNull()
    expect(formatSiteAddress(undefined)).toBeNull()
  })
})

describe('getSitePostcode', () => {
  it('prefers the nested object postcode over the flat field', () => {
    const payload = {
      siteAddress: { town: 'Leeds', postcode: 'LS1 1AB' },
      siteAddressPostcode: 'ZZ9 9ZZ'
    }
    expect(getSitePostcode(payload)).toBe('LS1 1AB')
  })

  it('trims the nested postcode', () => {
    expect(getSitePostcode({ siteAddress: { postcode: '  LS1 1AB  ' } })).toBe(
      'LS1 1AB'
    )
  })

  it('falls back to the flat field when the nested postcode is blank', () => {
    const payload = {
      siteAddress: { town: 'Leeds', postcode: '   ' },
      siteAddressPostcode: 'ZZ9 9ZZ'
    }
    expect(getSitePostcode(payload)).toBe('ZZ9 9ZZ')
  })

  it('falls back to the flat field when siteAddress is a legacy string', () => {
    const payload = {
      siteAddress: '1 Main St, Leeds',
      siteAddressPostcode: '  LS1 1AB  '
    }
    expect(getSitePostcode(payload)).toBe('LS1 1AB')
  })

  it('returns null when neither shape has a postcode', () => {
    expect(getSitePostcode({ siteAddress: { town: 'Leeds' } })).toBeNull()
    expect(getSitePostcode({})).toBeNull()
  })

  it('ignores a non-string flat postcode', () => {
    expect(getSitePostcode({ siteAddressPostcode: 42 })).toBeNull()
  })

  it('does not throw on null / undefined payload', () => {
    expect(getSitePostcode(null)).toBeNull()
    expect(getSitePostcode(undefined)).toBeNull()
  })
})
