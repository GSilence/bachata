#!/usr/bin/env python3
"""
Патч для совместимости madmom с Python 3.10+ и NumPy 1.20+
Исправляет импорты из collections в collections.abc
И добавляет обратную совместимость для устаревших numpy типов

Этот патч должен быть импортирован ДО импорта madmom
"""

import sys
import collections
import collections.abc
import numpy as np

# Патч 1: Python 3.10+ - collections
if sys.version_info >= (3, 10):
    # Добавляем обратную совместимость для старых импортов
    # Это нужно для библиотек, которые еще используют старый синтаксис
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence
    if not hasattr(collections, 'MutableMapping'):
        collections.MutableMapping = collections.abc.MutableMapping
    if not hasattr(collections, 'Mapping'):
        collections.Mapping = collections.abc.Mapping
    if not hasattr(collections, 'Sequence'):
        collections.Sequence = collections.abc.Sequence
    if not hasattr(collections, 'Iterable'):
        collections.Iterable = collections.abc.Iterable
    if not hasattr(collections, 'Iterator'):
        collections.Iterator = collections.abc.Iterator
    if not hasattr(collections, 'Callable'):
        collections.Callable = collections.abc.Callable
    if not hasattr(collections, 'Collection'):
        collections.Collection = collections.abc.Collection
    if not hasattr(collections, 'Container'):
        collections.Container = collections.abc.Container

# Патч 2: NumPy 1.20+ - устаревшие типы
# np.float, np.int, np.bool были удалены в новых версиях numpy
if not hasattr(np, 'float'):
    np.float = np.float64
if not hasattr(np, 'int'):
    np.int = np.int64
if not hasattr(np, 'bool'):
    np.bool = np.bool_
if not hasattr(np, 'complex'):
    np.complex = np.complex128

