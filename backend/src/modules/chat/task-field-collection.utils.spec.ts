import {
  aliasesForRequiredField,
  extractExplicitFieldValues,
  normalizeFieldText,
} from './task-field-collection.utils';

describe('task field collection explicit-field utilities', () => {
  it('normalizes labels and derives only conservative aliases', () => {
    expect(normalizeFieldText('  Tên  NPP ')).toBe('tên npp');
    expect(aliasesForRequiredField('Tên NPP')).toEqual(['tên npp', 'npp']);
    expect(aliasesForRequiredField('Tên tài khoản')).toEqual(['tên tài khoản', 'tài khoản']);
    expect(aliasesForRequiredField('Số điện thoại')).toEqual(['số điện thoại']);
    expect(aliasesForRequiredField('Mã NPP giao hàng')).toEqual(['mã npp giao hàng', 'npp']);
  });

  it.each([
    ['NPP Hải Phòng', { 'Tên NPP': 'Hải Phòng' }],
    ['NPP: Hải Phòng', { 'Tên NPP': 'Hải Phòng' }],
    ['NPP là Hải Phòng', { 'Tên NPP': 'Hải Phòng' }],
    ['Tài khoản: nguyenvana', { 'Tên tài khoản': 'nguyenvana' }],
    ['Tên tài khoản là nguyenvana', { 'Tên tài khoản': 'nguyenvana' }],
    ['À NPP của anh là Hải Phòng nhé, tài khoản nguyenvana', { 'Tên NPP': 'Hải Phòng', 'Tên tài khoản': 'nguyenvana' }],
  ])('extracts bounded explicit values from %s', (message, expected) => {
    expect(extractExplicitFieldValues(message, ['Tên tài khoản', 'Tên NPP'])).toEqual({
      matchedFields: expect.arrayContaining(Object.keys(expected)),
      collectedFields: expected,
    });
  });

  it('does not claim a field when only a value-free alias is supplied', () => {
    expect(extractExplicitFieldValues('NPP', ['Tên NPP'])).toEqual({
      matchedFields: ['Tên NPP'],
      collectedFields: {},
    });
  });
});
