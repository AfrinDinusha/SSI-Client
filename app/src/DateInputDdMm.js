import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';

export function formatDateForDisplay(dateStr) {
  if (!dateStr) return '';
  const value = String(dateStr).trim();
  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const displayMatch = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (displayMatch) {
    return value;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const day = String(parsed.getDate()).padStart(2, '0');
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const year = parsed.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return value;
}

export function parseDisplayDateToIso(dateStr) {
  if (!dateStr) return '';
  const value = String(dateStr).trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) {
    return '';
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearText = match[3];
  const year = yearText.length === 2 ? Number(`20${yearText}`) : Number(yearText);
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return '';
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Date filter input: shows DD/MM/YYYY, stores YYYY-MM-DD via onChange.
 */
export default function DateInputDdMm({
  value = '',
  onChange,
  id,
  name,
  className = '',
  disabled = false,
  min,
  max,
  placeholder = 'DD/MM/YYYY',
  style,
}) {
  const hiddenDateInputRef = useRef(null);
  const [displayValue, setDisplayValue] = useState(() => formatDateForDisplay(value));

  useEffect(() => {
    setDisplayValue(formatDateForDisplay(value));
  }, [value]);

  const openDatePicker = useCallback(() => {
    if (disabled) return;
    const input = hiddenDateInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === 'function') {
      input.showPicker();
      return;
    }
    input.focus();
    input.click();
  }, [disabled]);

  const hiddenValue = parseDisplayDateToIso(value) || parseDisplayDateToIso(displayValue);

  const handleTextChange = (e) => {
    const next = e.target.value;
    setDisplayValue(next);
    if (!next.trim()) {
      onChange?.('');
      return;
    }
    const iso = parseDisplayDateToIso(next);
    if (iso) {
      onChange?.(iso);
    }
  };

  const handlePickerChange = (e) => {
    const iso = e.target.value;
    setDisplayValue(formatDateForDisplay(iso));
    onChange?.(iso);
  };

  return (
    <div className="date-input-ddmm" style={{ position: 'relative', ...style }}>
      <input
        type="text"
        id={id}
        name={name}
        value={displayValue}
        onChange={handleTextChange}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        style={{ paddingRight: '44px', width: '100%', boxSizing: 'border-box' }}
        autoComplete="off"
      />
      <button
        type="button"
        onClick={openDatePicker}
        disabled={disabled}
        aria-label={name ? `Open ${name} calendar` : 'Open calendar'}
        style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          border: 'none',
          background: 'transparent',
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: '#2c3e50',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <CalendarDays size={18} />
      </button>
      <input
        ref={hiddenDateInputRef}
        type="date"
        value={hiddenValue}
        onChange={handlePickerChange}
        min={min}
        max={max}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0,
          pointerEvents: 'none',
          width: '100%',
          height: '100%',
        }}
      />
    </div>
  );
}
